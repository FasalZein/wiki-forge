import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, projectRoot, requireValue } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { createSpecDocumentInternal } from "./planning";

type BacklogItem = { raw: string; id: string; title: string };
type ParsedBacklog = { intro: string[]; sections: Record<string, BacklogItem[]>; order: string[] };

export function backlogCommand(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const result = collectBacklog(project);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const [section, items] of Object.entries(result.sections)) {
      console.log(`${section}: ${items.length}`);
      for (const item of items.slice(0, 20)) console.log(`- ${item.id} ${item.title}`);
    }
  }
}

export function addTask(args: string[]) {
  const options = parseTaskArgs(args);
  const backlogPath = backlogPathFor(options.project);
  const current = readFileSync(backlogPath, "utf8").replace(/\r\n/g, "\n");
  const taskId = nextTaskId(options.project, current);
  const taskLine = renderTaskLine(taskId, options.title, options.priority, options.tags);
  writeFileSync(backlogPath, insertTaskIntoSection(current, options.section, taskLine), "utf8");
  appendLogEntry("add-task", options.title, { project: options.project, details: [`task=${taskId}`, `section=${options.section}`] });
  const result = { project: options.project, taskId, section: options.section, title: options.title, backlogPath: relative(VAULT_ROOT, backlogPath) };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`added ${taskId} to ${relative(VAULT_ROOT, backlogPath)} (${options.section})`);
}

export function createIssueSlice(args: string[]) {
  const options = parseTaskArgs(args);
  const backlogPath = backlogPathFor(options.project);
  const current = readFileSync(backlogPath, "utf8").replace(/\r\n/g, "\n");
  const taskId = nextTaskId(options.project, current);
  const taskLine = renderTaskLine(taskId, options.title, options.priority, options.tags);
  writeFileSync(backlogPath, insertTaskIntoSection(current, options.section, taskLine), "utf8");

  const slugTitle = `${taskId.toLowerCase()} ${options.title}`;
  const planPath = createSpecDocumentInternal(options.project, "plan", slugTitle, [
    "# {{title}}",
    "",
    "## Task",
    "",
    "- ID: {{taskId}}",
    "",
    "## Scope",
    "",
    "- ",
    "",
    "## Vertical Slice",
    "",
    "1. ",
    "2. ",
    "3. ",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] ",
    "",
    "## Cross Links",
    "",
    "- [[projects/{{project}}/backlog]]",
  ], taskId);
  const testPlanPath = createSpecDocumentInternal(options.project, "test-plan", slugTitle, [
    "# {{title}}",
    "",
    "## Task",
    "",
    "- ID: {{taskId}}",
    "",
    "## Red Tests",
    "",
    "- [ ] ",
    "",
    "## Green Criteria",
    "",
    "- [ ] ",
    "",
    "## Refactor Checks",
    "",
    "- [ ] ",
    "",
    "## Cross Links",
    "",
    "- [[projects/{{project}}/backlog]]",
  ], taskId);

  appendLogEntry("create-issue-slice", options.title, { project: options.project, details: [`task=${taskId}`, `plan=${relative(VAULT_ROOT, planPath)}`, `test=${relative(VAULT_ROOT, testPlanPath)}`] });
  const result = { project: options.project, taskId, section: options.section, title: options.title, backlogPath: relative(VAULT_ROOT, backlogPath), planPath: relative(VAULT_ROOT, planPath), testPlanPath: relative(VAULT_ROOT, testPlanPath) };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`created issue slice ${taskId}`);
    console.log(`- backlog: ${result.backlogPath}`);
    console.log(`- plan: ${result.planPath}`);
    console.log(`- test-plan: ${result.testPlanPath}`);
  }
}

export function moveTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  const toIndex = args.indexOf("--to");
  const to = toIndex >= 0 ? args[toIndex + 1] : undefined;
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  requireValue(to, "to");
  const backlogPath = backlogPathFor(project);
  const parsed = parseBacklog(readFileSync(backlogPath, "utf8").replace(/\r\n/g, "\n"));
  const found = removeTask(parsed, taskId);
  if (!found) throw new Error(`task not found: ${taskId}`);
  parsed.sections[to] = parsed.sections[to] ?? [];
  if (!parsed.order.includes(to)) parsed.order.push(to);
  parsed.sections[to].unshift(found);
  writeFileSync(backlogPath, serializeBacklog(parsed), "utf8");
  appendLogEntry("move-task", taskId, { project, details: [`to=${to}`] });
  console.log(`moved ${taskId} -> ${to}`);
}

export function completeTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  moveTask([project, taskId, "--to", "Done"]);
}

export function collectBacklog(project: string) {
  const parsed = parseBacklog(readFileSync(backlogPathFor(project), "utf8").replace(/\r\n/g, "\n"));
  return { project, backlogPath: relative(VAULT_ROOT, backlogPathFor(project)), sections: parsed.sections };
}

function backlogPathFor(project: string) {
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const backlogPath = join(root, "backlog.md");
  assertExists(backlogPath, `backlog not found: ${relative(VAULT_ROOT, backlogPath)}`);
  return backlogPath;
}

function parseTaskArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  let section = "Todo";
  let priority: string | undefined;
  const tags: string[] = [];
  const titleParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--section") { section = args[index + 1] || section; index += 1; continue; }
    if (arg === "--priority") { priority = args[index + 1] || undefined; index += 1; continue; }
    if (arg === "--tag") { const tag = args[index + 1]; if (tag) tags.push(tag.replace(/^#/, "")); index += 1; continue; }
    if (arg === "--json") continue;
    titleParts.push(arg);
  }
  const title = titleParts.join(" ").trim();
  requireValue(title || undefined, "title");
  return { project, title, section, priority, tags, json: args.includes("--json") };
}

function renderTaskLine(taskId: string, title: string, priority?: string, tags: string[] = []) {
  return `- [ ] **${taskId}** ${title}${priority ? ` | ${priority}` : ""}${tags.length ? ` | ${tags.map((tag) => `#${tag}`).join(" ")}` : ""}`;
}

function nextTaskId(project: string, backlog: string) {
  const prefix = project.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
  const regex = new RegExp(`\\*\\*${prefix}-(\\d{3})\\*\\*`, "g");
  let max = 0;
  for (const match of backlog.matchAll(regex)) max = Math.max(max, Number.parseInt(match[1] || "0", 10));
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function insertTaskIntoSection(backlog: string, section: string, taskLine: string) {
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

function parseBacklog(backlog: string): ParsedBacklog {
  const lines = backlog.split("\n");
  const intro: string[] = [];
  const sections: Record<string, BacklogItem[]> = {};
  const order: string[] = [];
  let currentSection: string | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      currentSection = heading[1].trim();
      if (!sections[currentSection]) { sections[currentSection] = []; order.push(currentSection); }
      continue;
    }
    if (!currentSection) { intro.push(line); continue; }
    const task = line.match(/^- \[ \] \*\*([A-Z0-9-]+)\*\*\s+(.*)$/);
    if (task) sections[currentSection].push({ raw: line, id: task[1], title: task[2] });
  }
  return { intro, sections, order };
}

function serializeBacklog(parsed: ParsedBacklog) {
  const out = [...parsed.intro];
  for (const section of parsed.order) {
    out.push(`## ${section}`, "");
    for (const item of parsed.sections[section] ?? []) out.push(item.raw);
    out.push("");
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
