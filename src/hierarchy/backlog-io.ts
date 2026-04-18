import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, projectRoot, requireValue } from "../cli-shared";
import { readText, writeText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { readSliceDependencies } from "../lib/slices";

export type BacklogItem = { raw: string; id: string; title: string };
type ParsedBacklog = { intro: string[]; sections: Record<string, BacklogItem[]>; extras: Record<string, string[]>; order: string[] };

const BACKLOG_SECTIONS = ["In Progress", "Todo", "Backlog", "Done", "Cancelled"] as const;

export type TaskOptions = {
  project: string;
  title: string;
  section: string;
  priority?: string;
  tags: string[];
  parentPrd?: string;
  assignee?: string;
  sourcePaths: string[];
  json: boolean;
};
type AppendedTask = { backlogPath: string; taskId: string };

export async function backlogPathFor(project: string) {
  const root = projectRoot(project);
  await assertExists(root, `project not found: ${project}`);
  const backlogPath = join(root, "backlog.md");
  await assertExists(backlogPath, `backlog not found: ${relative(VAULT_ROOT, backlogPath)}`);
  return backlogPath;
}

export async function readNormalizedText(path: string) {
  return (await readText(path)).replace(/\r\n/g, "\n");
}

export async function appendTaskToBacklog(options: TaskOptions): Promise<AppendedTask> {
  const backlogPath = await backlogPathFor(options.project);
  const current = await readNormalizedText(backlogPath);
  const taskId = nextTaskId(options.project, current);
  const taskLine = renderTaskLine(taskId, options.title, options.priority, options.tags);
  await writeText(backlogPath, insertTaskIntoSection(current, options.section, taskLine));
  return { backlogPath, taskId };
}

export async function moveTaskToSection(project: string, taskId: string, to: string) {
  const backlogPath = await backlogPathFor(project);
  const parsed = parseBacklog(await readNormalizedText(backlogPath));
  const found = removeTask(parsed, taskId);
  if (!found) throw new Error(`task not found: ${taskId}`);
  if (to === "In Progress") {
    const doneIds = new Set((parsed.sections["Done"] ?? []).map((task) => task.id));
    const dependencies = await readSliceDependencies(project, taskId);
    const blockedBy = dependencies.filter((dependency) => !doneIds.has(dependency));
    if (blockedBy.length) throw new Error(`${taskId} is blocked by unfinished dependencies: ${blockedBy.join(", ")}`);
  }
  parsed.sections[to] = parsed.sections[to] ?? [];
  if (!parsed.order.includes(to)) parsed.order.push(to);
  parsed.sections[to].unshift(found);
  await writeText(backlogPath, serializeBacklog(parsed));
  appendLogEntry("move-task", taskId, { project, details: [`to=${to}`] });
}

// Recognizes all valid backlog checkbox variants:
// [ ] = open, [x] = done (normalized), [>] = in-progress/deferred,
// [/] = partial/in-progress, [-] = cancelled
const TASK_LINE_PATTERN = /^- \[[ x>\-/]\] \*\*([A-Z0-9-]+)\*\*\s+(.*)$/;

export function parseBacklog(backlog: string): ParsedBacklog {
  const lines = backlog.split("\n");
  const intro: string[] = [];
  const sections: Record<string, BacklogItem[]> = {};
  const extras: Record<string, string[]> = {};
  const order: string[] = [];
  let currentSection: string | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      const nextSection = heading[1].trim();
      currentSection = (BACKLOG_SECTIONS as readonly string[]).includes(nextSection) ? nextSection : null;
      if (currentSection && !sections[currentSection]) {
        sections[currentSection] = [];
        extras[currentSection] = [];
        order.push(currentSection);
      }
      continue;
    }
    if (!currentSection) {
      intro.push(line);
      continue;
    }
    const task = line.match(TASK_LINE_PATTERN);
    if (task) sections[currentSection].push({ raw: line, id: task[1], title: task[2] });
    else if (line.trim()) extras[currentSection].push(line);
  }
  return { intro, sections, extras, order };
}

export function serializeBacklog(parsed: ParsedBacklog) {
  const out = [...parsed.intro];
  for (const section of parsed.order) {
    out.push(`## ${section}`, "");
    for (const item of parsed.sections[section] ?? []) out.push(normalizeTaskCheckbox(item.raw));
    for (const line of parsed.extras[section] ?? []) out.push(line);
    out.push("");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function normalizeTaskCheckbox(raw: string) {
  return raw.replace(/^- \[x\] /, "- [ ] ");
}

export function renderTaskLine(taskId: string, title: string, priority?: string, tags: string[] = []) {
  return `- [ ] **${taskId}** ${title}${priority ? ` | ${priority}` : ""}${tags.length ? ` | ${tags.map((tag) => `#${tag}`).join(" ")}` : ""}`;
}

export function nextTaskId(project: string, backlog: string) {
  const prefix = project.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
  const regex = new RegExp(`\\*\\*${prefix}-(\\d{3})\\*\\*`, "g");
  let max = 0;
  for (const match of backlog.matchAll(regex)) max = Math.max(max, Number.parseInt(match[1] || "0", 10));
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function insertTaskIntoSection(backlog: string, section: string, taskLine: string) {
  const heading = `## ${section.trim()}`;
  if (!backlog.includes(heading)) throw new Error(`section not found in backlog.md: ${section}`);
  const lines = backlog.split("\n");
  const out: string[] = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i += 1) {
    out.push(lines[i]);
    if (!inserted && lines[i].trim() === heading) {
      out.push("", taskLine);
      inserted = true;
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function removeTask(parsed: ParsedBacklog, taskId: string) {
  for (const section of parsed.order) {
    const items = parsed.sections[section] ?? [];
    const index = items.findIndex((item) => item.id === taskId);
    if (index >= 0) return items.splice(index, 1)[0];
  }
  return null;
}

export function parseTaskArgs(args: string[]): TaskOptions {
  const project = args[0];
  requireValue(project, "project");
  let section = "Todo";
  let priority: string | undefined;
  let parentPrd: string | undefined;
  let assignee: string | undefined;
  const sourcePaths: string[] = [];
  const tags: string[] = [];
  const titleParts: string[] = [];

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--section":
        section = args[index + 1] || section;
        index += 1;
        break;
      case "--priority":
        priority = args[index + 1] || undefined;
        index += 1;
        break;
      case "--tag": {
        const tag = args[index + 1];
        if (tag) tags.push(tag.replace(/^#/, ""));
        index += 1;
        break;
      }
      case "--prd":
        parentPrd = args[index + 1] || undefined;
        index += 1;
        break;
      case "--assignee":
        assignee = args[index + 1] || undefined;
        index += 1;
        break;
      case "--source":
        while (args[index + 1] && !args[index + 1]?.startsWith("--")) {
          sourcePaths.push(String(args[index + 1]).replaceAll("\\", "/"));
          index += 1;
        }
        break;
      case "--json":
        break;
      default:
        titleParts.push(arg);
        break;
    }
  }

  const title = titleParts.join(" ").trim();
  requireValue(title || undefined, "title");
  return { project, title, section, priority, tags, parentPrd, assignee, sourcePaths, json: args.includes("--json") };
}

// OPEN_MARKER_PATTERN matches any non-cancelled, non-done checkbox that should be
// rewritten to [-] when a slice is cancelled.
// Matches: [ ] (open), [>] (in-progress/deferred), [/] (partial)
const OPEN_MARKER_PATTERN = /^(- \[)[ >/](] \*\*[A-Z0-9-]+\*\*)/;

/**
 * Rewrite the backlog row for `taskId` from an open marker ([ ], [>], [/]) to [-].
 * Optionally appends a trailing annotation `— cancelled: <reason>` to the row.
 *
 * Returns true if a row was found and rewritten, false if not found or already [-].
 * Does NOT move the row between sections (caller is responsible for that if needed).
 */
export async function rewriteBacklogRowMarker(
  project: string,
  taskId: string,
  annotation?: string,
): Promise<boolean> {
  const backlogPath = await backlogPathFor(project);
  const current = await readNormalizedText(backlogPath);
  const lines = current.split("\n");
  let changed = false;
  const next = lines.map((line) => {
    // Match the task row for this specific taskId with an open marker
    const taskMatch = line.match(/^- \[([ >/])\] \*\*([A-Z0-9-]+)\*\*(.*)$/);
    if (!taskMatch || taskMatch[2] !== taskId) return line;
    // Already [-] — skip (idempotent)
    if (taskMatch[1] === "-") return line;
    changed = true;
    // Strip any existing trailing annotation before re-appending
    const body = taskMatch[3].replace(/\s*—\s*cancelled:.*$/u, "");
    const annotationSuffix = annotation ? ` — cancelled: ${annotation}` : "";
    return `- [-] **${taskId}**${body}${annotationSuffix}`;
  });
  if (!changed) return false;
  await writeText(backlogPath, `${next.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`);
  return true;
}

/**
 * Inspect a backlog row for `taskId` and return its current marker character.
 * Returns null if the task is not found in the backlog.
 */
export async function getBacklogRowMarker(project: string, taskId: string): Promise<string | null> {
  const backlogPath = await backlogPathFor(project);
  const current = await readNormalizedText(backlogPath);
  for (const line of current.split("\n")) {
    const m = line.match(/^- \[([ >\-/x])\] \*\*([A-Z0-9-]+)\*\*/);
    if (m && m[2] === taskId) return m[1];
  }
  return null;
}
