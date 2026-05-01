import matter from "gray-matter";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { forgeProjectDir, forgeSliceDir, forgeSlicePath, forgeSlicePlanPath, forgeSliceTestPlanPath } from "./forge-paths";

/**
 * Read a slice hub file and return parsed frontmatter data, raw content, and metadata.
 */
export async function readSliceHub(
  vaultRoot: string,
  project: string,
  sliceId: string,
): Promise<{ readonly path: string; readonly data: Record<string, unknown>; readonly content: string; readonly markdown: string }> {
  const path = sliceIndexPath(vaultRoot, project, sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${project}/${sliceId}`);
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  const data: Record<string, unknown> = { ...parsed.data };
  return {
    path: normalizeVaultPath(relative(vaultRoot, path)),
    data,
    content: parsed.content,
    markdown: raw,
  };
}

/**
 * Update frontmatter fields on a slice hub file, removing specified keys.
 */
export async function updateSliceHub(
  vaultRoot: string,
  project: string,
  sliceId: string,
  updates: Record<string, unknown>,
  removals: readonly string[],
): Promise<void> {
  const path = sliceIndexPath(vaultRoot, project, sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${project}/${sliceId}`);
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  const data = { ...parsed.data, ...updates };
  for (const key of removals) delete data[key];
  await writeFile(path, matter.stringify(parsed.content, data));
}

/**
 * List all slice directory IDs in a project.
 */
export async function readAllSliceIds(vaultRoot: string, project: string): Promise<readonly string[]> {
  const slicesRoot = join(vaultRoot, `${forgeProjectDir(project)}/slices`);
  if (!existsSync(slicesRoot)) return [];
  const entries = await readdir(slicesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Compute the next available slice ID for a project given existing IDs.
 * Pure function — no filesystem I/O.
 */
export function nextSliceId(existingIds: readonly string[], project: string): string {
  const prefix = project.replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").toUpperCase();
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{3})$`, "u");
  let max = 0;
  for (const id of existingIds) {
    const match = id.match(pattern);
    if (!match) continue;
    max = Math.max(max, Number.parseInt(match[1] ?? "0", 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** Path to a slice index hub file. */
export function sliceIndexPath(vaultRoot: string, project: string, sliceId: string): string {
  return join(vaultRoot, forgeSlicePath(project, sliceId));
}

/** Paths for all slice documents. */
export function sliceDocPaths(vaultRoot: string, project: string, sliceId: string) {
  const dir = join(vaultRoot, forgeSliceDir(project, sliceId));
  return {
    dir,
    indexPath: join(vaultRoot, forgeSlicePath(project, sliceId)),
    planPath: join(vaultRoot, forgeSlicePlanPath(project, sliceId)),
    testPlanPath: join(vaultRoot, forgeSliceTestPlanPath(project, sliceId)),
  };
}

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

