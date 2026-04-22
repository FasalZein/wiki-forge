
import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { safeMatter } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "../../lib/structure";

export type SliceDocKind = "index" | "plan" | "test-plan";

export function sliceDocPaths(project: string, taskId: string) {
  return {
    indexPath: projectTaskHubPath(project, taskId),
    planPath: projectTaskPlanPath(project, taskId),
    testPlanPath: projectTaskTestPlanPath(project, taskId),
  };
}

export async function readSliceSourcePaths(project: string, taskId: string) {
  const sourcePaths = new Set<string>();
  for (const matter of await readSliceMatters(project, taskId)) {
    if (!Array.isArray(matter.data.source_paths)) continue;
    for (const sourcePath of matter.data.source_paths) {
      const normalized = String(sourcePath).replaceAll("\\", "/").trim();
      if (normalized) sourcePaths.add(normalized);
    }
  }
  return [...sourcePaths].sort();
}

export async function readSliceDependencies(project: string, taskId: string) {
  const dependencies = new Set<string>();
  for (const matter of await readSliceMatters(project, taskId)) {
    if (!Array.isArray(matter.data.depends_on)) continue;
    for (const dependency of matter.data.depends_on) {
      const normalized = String(dependency).trim().toUpperCase();
      if (normalized) dependencies.add(normalized);
    }
  }
  return [...dependencies].sort();
}

export async function readSliceDoc(project: string, taskId: string, kind: SliceDocKind) {
  const paths = sliceDocPaths(project, taskId);
  let path: string;
  if (kind === "index") path = paths.indexPath;
  else if (kind === "plan") path = paths.planPath;
  else path = paths.testPlanPath;
  if (!await exists(path)) throw new Error(`${kind} not found: ${relative(VAULT_ROOT, path)}`);
  const raw = await readText(path);
  const parsed = safeMatter(relative(VAULT_ROOT, path), raw);
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, path)}`);
  return { path, raw, content: parsed.content, data: parsed.data };
}

export async function readSliceTestPlan(project: string, taskId: string) {
  return readSliceDoc(project, taskId, "test-plan");
}

export async function readSliceHub(project: string, taskId: string) {
  return readSliceDoc(project, taskId, "index");
}

export async function readSlicePlan(project: string, taskId: string) {
  return readSliceDoc(project, taskId, "plan");
}

export async function readSliceAssignee(project: string, taskId: string) {
  for (const matter of await readSliceMatters(project, taskId)) {
    if (typeof matter.data.assignee === "string" && matter.data.assignee.trim()) return matter.data.assignee.trim();
  }
  return null;
}

export async function readSliceStatus(project: string, taskId: string) {
  for (const matter of await readSliceMatters(project, taskId)) {
    if (typeof matter.data.status === "string" && matter.data.status.trim()) return matter.data.status.trim();
  }
  return null;
}

export async function readSliceCompletedAt(project: string, taskId: string) {
  for (const matter of await readSliceMatters(project, taskId)) {
    const completedAt = readTimestampValue(matter.data.completed_at);
    if (completedAt) return completedAt;
  }
  return null;
}

export function hasCanonicalSliceCompletionEvidence(data: Record<string, unknown>) {
  return data.status === "done"
    && readTimestampValue(data.completed_at) !== null
    && data.last_forge_step === "close-slice"
    && data.last_forge_state === "passed"
    && data.last_forge_ok === true;
}

export async function readSliceCanonicalCompletion(project: string, taskId: string) {
  const hub = await readSliceHub(project, taskId);
  return hasCanonicalSliceCompletionEvidence(hub.data);
}

async function readSliceMatters(project: string, taskId: string) {
  const paths = (await Promise.all(Object.entries(sliceDocPaths(project, taskId)).map(async ([, path]) => (await exists(path) ? path : null)))).filter((p): p is string => p !== null);
  const results = await Promise.all(
    paths.map(async (path) => {
      const raw = await readText(path);
      const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
      if (!parsed) return null;
      return { path, content: parsed.content, data: parsed.data };
    }),
  );
  return results.filter((m): m is { path: string; content: string; data: Record<string, unknown> } => m !== null);
}

export async function readSliceSummary(project: string, taskId: string) {
  const matters = await readSliceMatters(project, taskId);
  const indexPath = sliceDocPaths(project, taskId).indexPath;
  let status: string | null = null;
  let completedAt: string | null = null;
  let canonicalCompletion = false;
  let assignee: string | null = null;
  const dependencies = new Set<string>();
  for (const matter of matters) {
    if (!status && typeof matter.data.status === "string" && matter.data.status.trim()) status = matter.data.status.trim();
    if (!completedAt) completedAt = readTimestampValue(matter.data.completed_at);
    if (!canonicalCompletion && matter.path === indexPath) canonicalCompletion = hasCanonicalSliceCompletionEvidence(matter.data);
    if (!assignee && typeof matter.data.assignee === "string" && matter.data.assignee.trim()) assignee = matter.data.assignee.trim();
    if (Array.isArray(matter.data.depends_on)) {
      for (const dependency of matter.data.depends_on) {
        const normalized = String(dependency).trim().toUpperCase();
        if (normalized) dependencies.add(normalized);
      }
    }
  }
  return { status, completedAt, canonicalCompletion, assignee, dependencies: [...dependencies].sort() };
}

function readTimestampValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}
