import { existsSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { safeMatter } from "../cli-shared";
import { readText } from "./fs";
import { projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "./structure";

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

export async function readSliceTestPlan(project: string, taskId: string) {
  const { testPlanPath } = sliceDocPaths(project, taskId);
  if (!existsSync(testPlanPath)) throw new Error(`test plan not found: ${relative(VAULT_ROOT, testPlanPath)}`);
  const raw = await readText(testPlanPath);
  const parsed = safeMatter(relative(VAULT_ROOT, testPlanPath), raw);
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, testPlanPath)}`);
  return { path: testPlanPath, raw, content: parsed.content, data: parsed.data };
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
