import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { forgeFeaturePath, forgePrdPath, forgeProjectDir, forgeSliceDir, forgeSlicePath, forgeSlicePlanPath, forgeSliceTestPlanPath } from "./forge-paths";

export type ForgeSequenceKind = "feature" | "prd" | "slice";

export type ForgeSliceDocumentPaths = {
  readonly dir: string;
  readonly indexPath: string;
  readonly planPath: string;
  readonly testPlanPath: string;
};

export function absoluteVaultPath(vaultRoot: string, relativePath: string): string {
  return join(vaultRoot, relativePath);
}

export function forgeArtifactDirectory(project: string, kind: ForgeSequenceKind): string {
  return `${forgeProjectDir(project)}/${artifactDirectoryName(kind)}`;
}

export function forgeSliceDocumentPaths(vaultRoot: string, project: string, sliceId: string): ForgeSliceDocumentPaths {
  return {
    dir: absoluteVaultPath(vaultRoot, forgeSliceDir(project, sliceId)),
    indexPath: absoluteVaultPath(vaultRoot, forgeSlicePath(project, sliceId)),
    planPath: absoluteVaultPath(vaultRoot, forgeSlicePlanPath(project, sliceId)),
    testPlanPath: absoluteVaultPath(vaultRoot, forgeSliceTestPlanPath(project, sliceId)),
  };
}

export function assertForgeSliceDocumentsMissing(paths: ForgeSliceDocumentPaths, sliceId: string): void {
  if (existsSync(paths.indexPath) || existsSync(paths.planPath) || existsSync(paths.testPlanPath)) {
    throw new Error(`slice docs already exist for ${sliceId}: ${normalizeVaultPath(paths.dir)}`);
  }
}

export async function nextForgeSequenceId(vaultRoot: string, project: string, kind: ForgeSequenceKind): Promise<string> {
  const max = await currentMaxSequenceNumber(vaultRoot, project, kind);
  return forgeSequenceId(project, kind, max + 1);
}

export async function currentMaxSequenceNumber(vaultRoot: string, project: string, kind: ForgeSequenceKind): Promise<number> {
  const dir = absoluteVaultPath(vaultRoot, forgeArtifactDirectory(project, kind));
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { withFileTypes: true });
  const pattern = forgeSequencePattern(project, kind);
  return entries.reduce((max, entry) => {
    if (!isExpectedArtifactEntry(entry, kind)) return max;
    const match = entry.name.match(pattern);
    return match ? Math.max(max, Number.parseInt(match[1] ?? "0", 10)) : max;
  }, 0);
}

export function forgeSequencePrefix(project: string, kind: ForgeSequenceKind): string {
  if (kind === "feature") return "FEAT";
  if (kind === "prd") return "PRD";
  return project.replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").toUpperCase();
}

export function forgeSequenceId(project: string, kind: ForgeSequenceKind, sequenceNumber: number): string {
  return `${forgeSequencePrefix(project, kind)}-${String(sequenceNumber).padStart(3, "0")}`;
}

export function forgeArtifactSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "untitled";
}

export function forgeArtifactPath(project: string, kind: "feature", id: string, slug: string): string;
export function forgeArtifactPath(project: string, kind: "prd", id: string, slug: string): string;
export function forgeArtifactPath(project: string, kind: "slice", id: string): string;
export function forgeArtifactPath(project: string, kind: ForgeSequenceKind, id: string, slug = "untitled"): string {
  if (kind === "feature") return forgeFeaturePath(project, id, slug);
  if (kind === "prd") return forgePrdPath(project, id, slug);
  return forgeSlicePath(project, id);
}

function artifactDirectoryName(kind: ForgeSequenceKind): "features" | "prds" | "slices" {
  if (kind === "feature") return "features";
  if (kind === "prd") return "prds";
  return "slices";
}

function forgeSequencePattern(project: string, kind: ForgeSequenceKind): RegExp {
  return new RegExp(`^${escapeRegExp(forgeSequencePrefix(project, kind))}-(\\d+)`, "u");
}

function isExpectedArtifactEntry(entry: { isDirectory(): boolean; isFile(): boolean }, kind: ForgeSequenceKind): boolean {
  return kind === "slice" ? entry.isDirectory() : entry.isFile();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}
