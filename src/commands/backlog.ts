import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, mkdirIfMissing, nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText, writeText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { isCanonicalPrdId, projectPrdsDir, projectTaskDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath, toVaultMarkdownPath, toVaultWikilinkPath } from "../lib/structure";
import { readSliceDependencies, readSliceSummary } from "../lib/slices";
import { agentNamesEqual, assertKnownAgent, readProjectAgents } from "../lib/agents";
import { writeProjectIndex } from "./index-log";

export type BacklogItem = { raw: string; id: string; title: string };
type ParsedBacklog = { intro: string[]; sections: Record<string, BacklogItem[]>; extras: Record<string, string[]>; order: string[] };
export type TaskDocState = "missing" | "incomplete" | "ready";
export type BacklogTaskContext = {
  id: string;
  title: string;
  section: string;
  assignee: string | null;
  sliceStatus: string | null;
  completedAt: string | null;
  taskHubPath?: string;
  planPath?: string;
  testPlanPath?: string;
  hasSliceDocs: boolean;
  planStatus: TaskDocState;
  testPlanStatus: TaskDocState;
  dependencies: string[];
  blockedBy: string[];
};
export type BacklogFocus = {
  project: string;
  activeTask: BacklogTaskContext | null;
  recommendedTask: BacklogTaskContext | null;
  inProgress: BacklogItem[];
  todo: BacklogItem[];
  warnings: string[];
  blocked: Array<{ id: string; blockedBy: string[] }>;
};
type PrdRecord = { prdId: string; title: string; parentFeature?: string; linkPath: string; sourcePaths: string[] };
type SliceSpecKind = "task-hub" | "plan" | "test-plan";
const BACKLOG_SECTIONS = ["In Progress", "Todo", "Backlog", "Done", "Cancelled"] as const;
type SlicePaths = { taskSpecsDir: string; indexPath: string; planPath: string; testPlanPath: string };
type AppendedTask = { backlogPath: string; taskId: string };

type TaskOptions = {
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

export async function backlogCommand(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const assigneeIndex = args.indexOf("--assignee");
  const assignee = assigneeIndex >= 0 ? args[assigneeIndex + 1] : undefined;
  if (assigneeIndex >= 0) requireValue(assignee, "assignee");
  const result = await collectBacklogView(project, assignee);
  if (json) console.log(JSON.stringify(result, null, 2));
  else printBacklogSummary(result.sections, assignee);
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
  if (options.assignee) await assertKnownAgent(options.project, options.assignee);
  const prd = options.parentPrd ? await resolvePrdRecord(options.project, options.parentPrd) : null;
  const appended = await appendTaskToBacklog(options);
  const title = `${appended.taskId.toLowerCase()} ${options.title}`;
  const slicePaths = createSlicePaths(options.project, appended.taskId);
  ensureSliceDocsMissing(appended.taskId, slicePaths);
  const sourcePaths = options.sourcePaths.length ? options.sourcePaths : (prd?.sourcePaths ?? []);
  if (!options.sourcePaths.length && prd && prd.sourcePaths.length > 3) {
    console.warn(`warning: ${prd.prdId} has ${prd.sourcePaths.length} inherited source_paths; consider --source for a narrower slice binding`);
  }

  writeSliceSpec(
    slicePaths.indexPath,
    buildSliceIndexContent(options.project, appended.taskId, options.title, prd, slicePaths),
    buildSliceFrontmatter(`${appended.taskId} ${options.title}`, "task-hub", options.project, appended.taskId, prd, sourcePaths, options.assignee),
  );
  writeSliceSpec(
    slicePaths.planPath,
    buildSlicePlanContent(options.project, appended.taskId, title, prd, slicePaths),
    buildSliceFrontmatter(title, "plan", options.project, appended.taskId, prd, sourcePaths, options.assignee),
  );
  writeSliceSpec(
    slicePaths.testPlanPath,
    buildSliceTestPlanContent(options.project, appended.taskId, title, prd, slicePaths),
    buildSliceFrontmatter(title, "test-plan", options.project, appended.taskId, prd, sourcePaths, options.assignee),
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
  await moveTaskToSection(project, taskId, to);
  console.log(`moved ${taskId} -> ${to}`);
}

export async function completeTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  await moveTaskToSection(project, taskId, "Done");
  console.log(`moved ${taskId} -> Done`);
}

export async function collectBacklog(project: string) {
  const backlogPath = backlogPathFor(project);
  const parsed = parseBacklog(await readNormalizedText(backlogPath));
  return { project, backlogPath: relative(VAULT_ROOT, backlogPath), sections: parsed.sections };
}

export async function collectBacklogView(project: string, assignee?: string) {
  const backlog = await collectBacklog(project);
  const doneIds = new Set((backlog.sections["Done"] ?? []).map((task) => task.id));
  const sections = Object.fromEntries(await Promise.all(Object.entries(backlog.sections).map(async ([section, items]) => {
    const contexts = await Promise.all(items.map((item) => collectTaskContext(project, item, section, doneIds)));
    const filtered = assignee ? contexts.filter((context) => agentNamesEqual(context.assignee ?? undefined, assignee)) : contexts;
    return [section, filtered];
  })));
  const blocked = Object.values(sections).flat().filter((item): item is BacklogTaskContext => Boolean(item) && typeof item === "object" && Array.isArray((item as BacklogTaskContext).blockedBy) && (item as BacklogTaskContext).blockedBy.length > 0);
  return { project, assignee: assignee ?? null, knownAgents: await readProjectAgents(project), sections, blocked };
}

export async function collectBacklogFocus(project: string, preloadedBacklog?: Awaited<ReturnType<typeof collectBacklog>>): Promise<BacklogFocus> {
  const backlog = preloadedBacklog ?? await collectBacklog(project);
  const inProgress = backlog.sections["In Progress"] ?? [];
  const todo = backlog.sections["Todo"] ?? [];
  const doneIds = new Set((backlog.sections["Done"] ?? []).map((task) => task.id));
  const activeTask = inProgress[0] ? await collectTaskContext(project, inProgress[0], "In Progress", doneIds) : null;
  const todoContexts = await Promise.all(todo.map((item) => collectTaskContext(project, item, "Todo", doneIds)));
  const recommendedTask = activeTask ?? todoContexts.find((task) => task.blockedBy.length === 0) ?? null;
  const blocked = todoContexts.filter((task) => task.blockedBy.length > 0).map((task) => ({ id: task.id, blockedBy: task.blockedBy }));
  const warnings: string[] = [];
  if (inProgress.length > 1) warnings.push(`multiple tasks are in progress: ${inProgress.map((task) => task.id).join(", ")}`);
  if (activeTask?.hasSliceDocs) {
    if (activeTask.planStatus !== "ready") warnings.push(`${activeTask.id} plan is ${activeTask.planStatus}`);
    if (activeTask.testPlanStatus !== "ready") warnings.push(`${activeTask.id} test-plan is ${activeTask.testPlanStatus}`);
    if (activeTask.blockedBy.length) warnings.push(`${activeTask.id} is blocked by ${activeTask.blockedBy.join(", ")}`);
  }
  for (const task of todoContexts.filter((entry) => entry.blockedBy.length > 0)) warnings.push(`${task.id} blocked by ${task.blockedBy.join(", ")}`);
  if (!activeTask && recommendedTask?.hasSliceDocs) warnings.push(`no task is marked In Progress; next ready slice is ${recommendedTask.id}`);
  return { project, activeTask, recommendedTask, inProgress, todo, warnings, blocked };
}

function printBacklogSummary(sections: Record<string, BacklogTaskContext[]>, assignee?: string) {
  if (assignee) console.log(`assignee filter: ${assignee}`);
  for (const [section, items] of Object.entries(sections)) {
    console.log(`${section}: ${items.length}`);
    for (const item of items.slice(0, 20)) {
      const suffix = [item.assignee ? `assignee=${item.assignee}` : null, item.blockedBy.length ? `blocked by ${item.blockedBy.join(", ")}` : null, item.sliceStatus ? `status=${item.sliceStatus}` : null].filter(Boolean).join(" | ");
      console.log(`- ${item.id} ${item.title}${suffix ? ` | ${suffix}` : ""}`);
    }
  }
}

async function collectTaskContext(project: string, item: BacklogItem, section: string, doneIds?: Set<string>): Promise<BacklogTaskContext> {
  const taskHubPath = projectTaskHubPath(project, item.id);
  const planPath = projectTaskPlanPath(project, item.id);
  const testPlanPath = projectTaskTestPlanPath(project, item.id);
  const hasTaskHub = existsSync(taskHubPath);
  const hasPlan = existsSync(planPath);
  const hasTestPlan = existsSync(testPlanPath);
  const [summary, planStatus, testPlanStatus] = await Promise.all([
    readSliceSummary(project, item.id),
    detectTaskDocState(planPath),
    detectTaskDocState(testPlanPath),
  ]);
  const { status: sliceStatus, completedAt, assignee, dependencies } = summary;
  const blockedBy = doneIds ? dependencies.filter((dependency) => !doneIds.has(dependency)) : [];
  return {
    id: item.id,
    title: item.title,
    section,
    assignee,
    sliceStatus,
    completedAt,
    ...(hasTaskHub ? { taskHubPath: toVaultMarkdownPath(taskHubPath) } : {}),
    ...(hasPlan ? { planPath: toVaultMarkdownPath(planPath) } : {}),
    ...(hasTestPlan ? { testPlanPath: toVaultMarkdownPath(testPlanPath) } : {}),
    hasSliceDocs: hasTaskHub || hasPlan || hasTestPlan,
    planStatus,
    testPlanStatus,
    dependencies,
    blockedBy,
  };
}

async function detectTaskDocState(path: string): Promise<TaskDocState> {
  if (!existsSync(path)) return "missing";
  const raw = await readNormalizedText(path);
  const parsed = safeMatter(path, raw, { silent: true });
  const body = parsed?.content ?? raw.replace(/^---\n[\s\S]*?\n---\n?/u, "");
  if (/^\s*(?:-\s*(?:\[ \])?\s*|\d+\.\s*)$/mu.test(body)) return "incomplete";
  return "ready";
}

export async function collectTaskContextForId(project: string, taskId: string): Promise<BacklogTaskContext | null> {
  const backlog = await collectBacklog(project);
  const doneIds = new Set((backlog.sections["Done"] ?? []).map((task) => task.id));
  for (const [section, items] of Object.entries(backlog.sections)) {
    const item = items.find((entry) => entry.id === taskId);
    if (item) return collectTaskContext(project, item, section, doneIds);
  }
  return null;
}

export async function moveTaskToSection(project: string, taskId: string, to: string) {
  const backlogPath = backlogPathFor(project);
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

function buildSliceFrontmatter(title: string, specKind: SliceSpecKind, project: string, taskId: string, prd: PrdRecord | null, sourcePaths: string[], assignee?: string) {
  return orderFrontmatter({
    title,
    type: "spec",
    spec_kind: specKind,
    project,
    ...(sourcePaths.length ? { source_paths: sourcePaths } : {}),
    ...(assignee ? { assignee } : {}),
    task_id: taskId,
    ...(prd?.prdId ? { parent_prd: prd.prdId } : {}),
    ...(prd?.parentFeature ? { parent_feature: prd.parentFeature } : {}),
    created_at: nowIso(),
    updated: nowIso(),
    status: "draft",
  }, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"]);
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
    "> [!tip]",
    "> Add `depends_on` in frontmatter when this slice must wait for another slice to finish.",
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
    "## Verification Commands",
    "",
    "```bash",
    "# add one or more repo-root commands that prove this slice is done",
    "```",
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
