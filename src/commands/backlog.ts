import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, mkdirIfMissing, nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText, writeText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { isCanonicalPrdId, projectPrdsDir, projectTaskDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath, toVaultWikilinkPath } from "../lib/structure";
import { writeProjectIndex } from "./index-log";

type BacklogItem = { raw: string; id: string; title: string };
type ParsedBacklog = { intro: string[]; sections: Record<string, BacklogItem[]>; extras: Record<string, string[]>; order: string[] };
type PrdRecord = { prdId: string; title: string; parentFeature?: string; linkPath: string; sourcePaths: string[] };
type SliceSpecKind = "task-hub" | "plan" | "test-plan";
type SlicePaths = { taskSpecsDir: string; indexPath: string; planPath: string; testPlanPath: string };
type AppendedTask = { backlogPath: string; taskId: string };

type TaskOptions = {
  project: string;
  title: string;
  section: string;
  priority?: string;
  tags: string[];
  parentPrd?: string;
  json: boolean;
};

export async function backlogCommand(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const result = await collectBacklog(project);
  if (json) console.log(JSON.stringify(result, null, 2));
  else printBacklogSummary(result.sections);
}

export async function addTask(args: string[]) {
  const options = parseTaskArgs(args);
  const appended = await appendTaskToBacklog(options);
  appendLogEntry("add-task", options.title, { project: options.project, details: [`task=${appended.taskId}`, `section=${options.section}`] });
  const result = {
    project: options.project,
    taskId: appended.taskId,
    section: options.section,
    title: options.title,
    backlogPath: relative(VAULT_ROOT, appended.backlogPath),
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`added ${appended.taskId} to ${relative(VAULT_ROOT, appended.backlogPath)} (${options.section})`);
}

export async function createIssueSlice(args: string[]) {
  const options = parseTaskArgs(args);
  const prd = options.parentPrd ? await resolvePrdRecord(options.project, options.parentPrd) : null;
  const appended = await appendTaskToBacklog(options);
  const title = `${appended.taskId.toLowerCase()} ${options.title}`;
  const slicePaths = createSlicePaths(options.project, appended.taskId);
  ensureSliceDocsMissing(appended.taskId, slicePaths);

  writeSliceSpec(
    slicePaths.indexPath,
    buildSliceIndexContent(options.project, appended.taskId, options.title, prd, slicePaths),
    buildSliceFrontmatter(`${appended.taskId} ${options.title}`, "task-hub", options.project, appended.taskId, prd),
  );
  writeSliceSpec(
    slicePaths.planPath,
    buildSlicePlanContent(options.project, appended.taskId, title, prd, slicePaths),
    buildSliceFrontmatter(title, "plan", options.project, appended.taskId, prd),
  );
  writeSliceSpec(
    slicePaths.testPlanPath,
    buildSliceTestPlanContent(options.project, appended.taskId, title, prd, slicePaths),
    buildSliceFrontmatter(title, "test-plan", options.project, appended.taskId, prd),
  );

  await writeProjectIndex(options.project);
  appendLogEntry("create-issue-slice", options.title, {
    project: options.project,
    details: [
      `task=${appended.taskId}`,
      `hub=${relative(VAULT_ROOT, slicePaths.indexPath)}`,
      `plan=${relative(VAULT_ROOT, slicePaths.planPath)}`,
      `test=${relative(VAULT_ROOT, slicePaths.testPlanPath)}`,
    ],
  });
  const result = {
    project: options.project,
    taskId: appended.taskId,
    section: options.section,
    title: options.title,
    backlogPath: relative(VAULT_ROOT, appended.backlogPath),
    indexPath: relative(VAULT_ROOT, slicePaths.indexPath),
    planPath: relative(VAULT_ROOT, slicePaths.planPath),
    testPlanPath: relative(VAULT_ROOT, slicePaths.testPlanPath),
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`created issue slice ${appended.taskId}`);
    console.log(`- backlog: ${result.backlogPath}`);
    console.log(`- index: ${result.indexPath}`);
    console.log(`- plan: ${result.planPath}`);
    console.log(`- test-plan: ${result.testPlanPath}`);
  }
}

export async function moveTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  const toIndex = args.indexOf("--to");
  const to = toIndex >= 0 ? args[toIndex + 1] : undefined;
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  requireValue(to, "to");
  const backlogPath = backlogPathFor(project);
  const parsed = parseBacklog(await readNormalizedText(backlogPath));
  const found = removeTask(parsed, taskId);
  if (!found) throw new Error(`task not found: ${taskId}`);
  parsed.sections[to] = parsed.sections[to] ?? [];
  if (!parsed.order.includes(to)) parsed.order.push(to);
  parsed.sections[to].unshift(found);
  await writeText(backlogPath, serializeBacklog(parsed));
  appendLogEntry("move-task", taskId, { project, details: [`to=${to}`] });
  console.log(`moved ${taskId} -> ${to}`);
}

export async function completeTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  await moveTask([project, taskId, "--to", "Done"]);
}

export async function collectBacklog(project: string) {
  const backlogPath = backlogPathFor(project);
  const parsed = parseBacklog(await readNormalizedText(backlogPath));
  return { project, backlogPath: relative(VAULT_ROOT, backlogPath), sections: parsed.sections };
}

function printBacklogSummary(sections: Record<string, BacklogItem[]>) {
  for (const [section, items] of Object.entries(sections)) {
    console.log(`${section}: ${items.length}`);
    for (const item of items.slice(0, 20)) console.log(`- ${item.id} ${item.title}`);
  }
}

function backlogPathFor(project: string) {
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const backlogPath = join(root, "backlog.md");
  assertExists(backlogPath, `backlog not found: ${relative(VAULT_ROOT, backlogPath)}`);
  return backlogPath;
}

async function readNormalizedText(path: string) {
  return (await readText(path)).replace(/\r\n/g, "\n");
}

async function appendTaskToBacklog(options: TaskOptions): Promise<AppendedTask> {
  const backlogPath = backlogPathFor(options.project);
  const current = await readNormalizedText(backlogPath);
  const taskId = nextTaskId(options.project, current);
  const taskLine = renderTaskLine(taskId, options.title, options.priority, options.tags);
  await writeText(backlogPath, insertTaskIntoSection(current, options.section, taskLine));
  return { backlogPath, taskId };
}

function parseTaskArgs(args: string[]): TaskOptions {
  const project = args[0];
  requireValue(project, "project");
  let section = "Todo";
  let priority: string | undefined;
  let parentPrd: string | undefined;
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
      case "--json":
        break;
      default:
        titleParts.push(arg);
        break;
    }
  }

  const title = titleParts.join(" ").trim();
  requireValue(title || undefined, "title");
  return { project, title, section, priority, tags, parentPrd, json: args.includes("--json") };
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

function createSlicePaths(project: string, taskId: string): SlicePaths {
  const taskSpecsDir = projectTaskDir(project, taskId);
  mkdirIfMissing(taskSpecsDir);
  return {
    taskSpecsDir,
    indexPath: projectTaskHubPath(project, taskId),
    planPath: projectTaskPlanPath(project, taskId),
    testPlanPath: projectTaskTestPlanPath(project, taskId),
  };
}

function ensureSliceDocsMissing(taskId: string, paths: SlicePaths) {
  if (existsSync(paths.indexPath) || existsSync(paths.planPath) || existsSync(paths.testPlanPath)) {
    throw new Error(`slice docs already exist for ${taskId}: ${relative(VAULT_ROOT, paths.taskSpecsDir)}`);
  }
}

function parentPrdSection(prd: PrdRecord | null) {
  return prd ? ["## Parent PRD", "", `- [[${prd.linkPath}|${prd.title}]]`, ""] : [];
}

function buildSliceFrontmatter(title: string, specKind: SliceSpecKind, project: string, taskId: string, prd: PrdRecord | null) {
  return orderFrontmatter({
    title,
    type: "spec",
    spec_kind: specKind,
    project,
    ...(prd?.sourcePaths.length ? { source_paths: prd.sourcePaths } : {}),
    task_id: taskId,
    ...(prd?.prdId ? { parent_prd: prd.prdId } : {}),
    ...(prd?.parentFeature ? { parent_feature: prd.parentFeature } : {}),
    created_at: nowIso(),
    updated: nowIso(),
    status: "draft",
  }, ["title", "type", "spec_kind", "project", "source_paths", "task_id", "parent_prd", "parent_feature", "created_at", "updated", "status"]);
}

function writeSliceSpec(path: string, content: string, frontmatter: Record<string, unknown>) {
  writeNormalizedPage(path, content, frontmatter);
}

function buildSliceIndexContent(project: string, taskId: string, title: string, prd: PrdRecord | null, paths: SlicePaths) {
  return [
    `# ${taskId} — ${title}`,
    "",
    "> [!summary]",
    `> Canonical hub for slice ${taskId}. Keep plan and test plan linked here so agents stay inside one bounded workspace.`,
    "",
    ...parentPrdSection(prd),
    "## Documents",
    "",
    `- [[${toVaultWikilinkPath(paths.planPath)}]]`,
    `- [[${toVaultWikilinkPath(paths.testPlanPath)}]]`,
    "",
    "## Cross Links",
    "",
    ...(prd ? [`- [[${prd.linkPath}|${prd.title}]]`] : []),
    `- [[projects/${project}/backlog]]`,
    `- [[projects/${project}/specs/index]]`,
    "",
  ].join("\n");
}

function buildSlicePlanContent(project: string, taskId: string, title: string, prd: PrdRecord | null, paths: SlicePaths) {
  return [
    `# ${title}`,
    "",
    "> [!summary]",
    `> Canonical execution plan for slice ${taskId}. Keep the slice vertical and independently verifiable.`,
    "",
    ...parentPrdSection(prd),
    "## Task",
    "",
    `- ID: ${taskId}`,
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
    `- [[${toVaultWikilinkPath(paths.indexPath)}]]`,
    `- [[${toVaultWikilinkPath(paths.testPlanPath)}]]`,
    ...(prd ? [`- [[${prd.linkPath}|${prd.title}]]`] : []),
    `- [[projects/${project}/backlog]]`,
    `- [[projects/${project}/specs/index]]`,
    "",
  ].join("\n");
}

function buildSliceTestPlanContent(project: string, taskId: string, title: string, prd: PrdRecord | null, paths: SlicePaths) {
  return [
    `# ${title}`,
    "",
    "> [!summary]",
    `> Red-green-refactor checklist for slice ${taskId}.`,
    "",
    ...parentPrdSection(prd),
    "## Task",
    "",
    `- ID: ${taskId}`,
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
    `- [[${toVaultWikilinkPath(paths.indexPath)}]]`,
    `- [[${toVaultWikilinkPath(paths.planPath)}]]`,
    ...(prd ? [`- [[${prd.linkPath}|${prd.title}]]`] : []),
    `- [[projects/${project}/backlog]]`,
    `- [[projects/${project}/specs/index]]`,
    "",
  ].join("\n");
}

function parseBacklog(backlog: string): ParsedBacklog {
  const lines = backlog.split("\n");
  const intro: string[] = [];
  const sections: Record<string, BacklogItem[]> = {};
  const extras: Record<string, string[]> = {};
  const order: string[] = [];
  let currentSection: string | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      currentSection = heading[1].trim();
      if (!sections[currentSection]) {
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
    const task = line.match(/^- \[ \] \*\*([A-Z0-9-]+)\*\*\s+(.*)$/);
    if (task) sections[currentSection].push({ raw: line, id: task[1], title: task[2] });
    else if (line.trim()) extras[currentSection].push(line);
  }
  return { intro, sections, extras, order };
}

function serializeBacklog(parsed: ParsedBacklog) {
  const out = [...parsed.intro];
  for (const section of parsed.order) {
    out.push(`## ${section}`, "");
    for (const item of parsed.sections[section] ?? []) out.push(item.raw);
    for (const line of parsed.extras[section] ?? []) out.push(line);
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

async function resolvePrdRecord(project: string, prdId: string): Promise<PrdRecord> {
  if (!isCanonicalPrdId(prdId)) throw new Error(`invalid PRD id: ${prdId}`);
  const dir = projectPrdsDir(project);
  assertExists(dir, `PRD not found: ${prdId}`);
  const fileName = readdirSync(dir).find((entry) => entry.startsWith(`${prdId}-`) && entry.endsWith(".md"));
  if (!fileName) throw new Error(`PRD not found: ${prdId}`);
  const file = join(dir, fileName);
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  const title = typeof parsed?.data.title === "string" && parsed.data.title.trim() ? parsed.data.title.trim() : prdId;
  const parentFeature = typeof parsed?.data.parent_feature === "string" ? parsed.data.parent_feature : undefined;
  const sourcePaths = Array.isArray(parsed?.data.source_paths) ? parsed.data.source_paths.map((value) => String(value).replaceAll("\\", "/")).filter(Boolean) : [];
  return { prdId, title, parentFeature, linkPath: toVaultWikilinkPath(file), sourcePaths };
}
