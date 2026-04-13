import { existsSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { safeMatter } from "../cli-shared";
import { readText } from "./fs";
import { projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "./structure";

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
  const path = kind === "index" ? sliceDocPaths(project, taskId).indexPath : kind === "plan" ? sliceDocPaths(project, taskId).planPath : sliceDocPaths(project, taskId).testPlanPath;
  if (!existsSync(path)) throw new Error(`${kind} not found: ${relative(VAULT_ROOT, path)}`);
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

export function extractShellCommandBlocks(markdown: string) {
  const blocks: string[] = [];
  const regex = /```(?:bash|sh|shell)\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(regex)) {
    const block = (match[1] ?? "").trim();
    if (block) blocks.push(block);
  }
  return blocks;
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
    if (typeof matter.data.completed_at === "string" && matter.data.completed_at.trim()) return matter.data.completed_at.trim();
  }
  return null;
}

async function readSliceMatters(project: string, taskId: string) {
  const matters: Array<{ path: string; content: string; data: Record<string, unknown> }> = [];
  for (const path of Object.values(sliceDocPaths(project, taskId))) {
    if (!existsSync(path)) continue;
    const raw = await readText(path);
    const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
    if (!parsed) continue;
    matters.push({ path, content: parsed.content, data: parsed.data });
  }
  return matters;
}
