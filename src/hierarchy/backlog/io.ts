import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { assertExists, projectRoot } from "../../cli-shared";
import { readText } from "../../lib/fs";

export type BacklogItem = { raw: string; id: string; title: string };
type ParsedBacklog = { intro: string[]; sections: Record<string, BacklogItem[]>; extras: Record<string, string[]>; order: string[] };

const BACKLOG_SECTIONS = ["In Progress", "Todo", "Backlog", "Done", "Cancelled"] as const;

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
