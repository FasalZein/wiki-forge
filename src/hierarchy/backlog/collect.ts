import { exists, readText } from "../../lib/fs";
import { safeMatter } from "../../cli-shared";
import { projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath, toVaultMarkdownPath } from "../../lib/structure";
import { agentNamesEqual, readProjectAgents } from "../../lib/agents";
import { hasSliceDocScaffoldPlaceholders } from "../../lib/slices/placeholders";
import { backlogPathFor, readNormalizedText, parseBacklog } from "./io";
import type { BacklogItem } from "./io";
import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { readSliceSummary } from "../../slice/docs";

export type TaskDocState = "missing" | "incomplete" | "ready";
export type BacklogTaskContext = {
  id: string;
  title: string;
  section: string;
  assignee: string | null;
  sliceStatus: string | null;
  completedAt: string | null;
  canonicalCompletion: boolean;
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

export async function collectBacklog(project: string) {
  const backlogPath = await backlogPathFor(project);
  const parsed = parseBacklog(await readNormalizedText(backlogPath));
  const sections = await projectBacklogSections(project, parsed.sections);
  return { project, backlogPath: relative(VAULT_ROOT, backlogPath), sections };
}

async function projectBacklogSections(project: string, sections: Record<string, BacklogItem[]>) {
  const projected: Record<string, BacklogItem[]> = {};
  for (const section of Object.keys(sections)) projected[section] = [];
  const entries = Object.entries(sections).flatMap(([section, items]) => items.map((item) => ({ section, item })));
  const summaries = await Promise.all(entries.map(({ item }) => readSliceSummary(project, item.id)));
  for (let index = 0; index < entries.length; index += 1) {
    const { section, item } = entries[index];
    const projectedSection = projectTaskSectionFromSliceSummary(
      section,
      summaries[index]?.canonicalCompletion ?? false,
      summaries[index]?.status ?? null,
    );
    projected[projectedSection] = projected[projectedSection] ?? [];
    projected[projectedSection].push(item);
  }
  return projected;
}

function projectTaskSectionFromSliceSummary(section: string, canonicalCompletion: boolean, status: string | null) {
  if (canonicalCompletion) return "Done";
  if (status === "in-progress") return "In Progress";
  if (status === "cancelled") return "Cancelled";
  return section;
}

export async function collectBacklogView(project: string, assignee?: string) {
  const backlog = await collectBacklog(project);
  const doneIds = await collectCanonicalDoneIds(project, backlog.sections);
  const sections = Object.fromEntries(await Promise.all(Object.entries(backlog.sections).map(async ([section, items]) => {
    const contexts = await Promise.all(items.map((item) => collectTaskContext(project, item, section, doneIds)));
    let filtered;
    if (assignee) {
      filtered = contexts.filter((context) => agentNamesEqual(context.assignee ?? undefined, assignee));
    } else {
      filtered = contexts;
    }
    return [section, filtered];
  })));
  const blocked = Object.values(sections).flat().filter((item): item is BacklogTaskContext => Boolean(item) && typeof item === "object" && Array.isArray((item as BacklogTaskContext).blockedBy) && (item as BacklogTaskContext).blockedBy.length > 0);
  return { project, assignee: assignee ?? null, knownAgents: await readProjectAgents(project), sections, blocked };
}

export async function collectBacklogFocus(project: string, preloadedBacklog?: Awaited<ReturnType<typeof collectBacklog>>): Promise<BacklogFocus> {
  const backlog = preloadedBacklog ?? await collectBacklog(project);
  const inProgress = backlog.sections["In Progress"] ?? [];
  const todo = backlog.sections["Todo"] ?? [];
  const doneIds = await collectCanonicalDoneIds(project, backlog.sections);
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
  if (!activeTask && recommendedTask?.hasSliceDocs) warnings.push(`no task is marked In Progress; next queued slice is ${recommendedTask.id}`);
  return { project, activeTask, recommendedTask, inProgress, todo, warnings, blocked };
}

async function collectTaskContext(project: string, item: BacklogItem, section: string, doneIds?: Set<string>): Promise<BacklogTaskContext> {
  const taskHubPath = projectTaskHubPath(project, item.id);
  const planPath = projectTaskPlanPath(project, item.id);
  const testPlanPath = projectTaskTestPlanPath(project, item.id);
  const hasTaskHub = await exists(taskHubPath);
  const hasPlan = await exists(planPath);
  const hasTestPlan = await exists(testPlanPath);
  const [summary, planStatus, testPlanStatus] = await Promise.all([
    readSliceSummary(project, item.id),
    detectTaskDocState(planPath),
    detectTaskDocState(testPlanPath),
  ]);
  const { status: sliceStatus, completedAt, canonicalCompletion, assignee, dependencies } = summary;
  const blockedBy = doneIds ? dependencies.filter((dependency) => !doneIds.has(dependency)) : [];
  return {
    id: item.id,
    title: item.title,
    section,
    assignee,
    sliceStatus,
    completedAt,
    canonicalCompletion,
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

export async function detectTaskDocState(path: string): Promise<TaskDocState> {
  if (!await exists(path)) return "missing";
  const raw = await readNormalizedText(path);
  const parsed = safeMatter(path, raw, { silent: true });
  const status = typeof parsed?.data.status === "string" ? parsed.data.status.trim().toLowerCase() : "";
  const specKind = parsed?.data.spec_kind;
  const body = parsed?.content ?? raw.replace(/^---\n[\s\S]*?\n---\n?/u, "");
  if (status === "draft") return "incomplete";
  if (hasSliceDocScaffoldPlaceholders(specKind, body)) return "incomplete";
  if (/^\s*(?:-\s*(?:\[ \])?\s*|\d+\.\s*)$/mu.test(body)) return "incomplete";
  if (status === "ready") return "ready";
  return "ready";
}

export async function collectTaskContextForId(project: string, taskId: string): Promise<BacklogTaskContext | null> {
  const backlog = await collectBacklog(project);
  const doneIds = await collectCanonicalDoneIds(project, backlog.sections);
  for (const [section, items] of Object.entries(backlog.sections)) {
    const item = items.find((entry) => entry.id === taskId);
    if (item) return collectTaskContext(project, item, section, doneIds);
  }
  return null;
}

async function collectCanonicalDoneIds(project: string, sections: Record<string, BacklogItem[]>) {
  const entries = Object.values(sections).flat();
  const summaries = await Promise.all(entries.map((item) => readSliceSummary(project, item.id)));
  const doneIds = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    if (summaries[index]?.canonicalCompletion) doneIds.add(entries[index]!.id);
  }
  return doneIds;
}
