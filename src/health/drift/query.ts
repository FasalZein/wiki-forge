import type { VerificationLevel } from "../../constants";
import { requireValue, type safeMatter } from "../../cli-shared";
import { batchGitLastModified, parseUpdatedDate, resolveRepoPath, assertGitRepo, sourcePathStatus } from "../../lib/verification";

export type DriftSnapshotPageEntry = {
  file: string;
  relPath: string;
  sourcePaths: string[];
  parsed: ReturnType<typeof safeMatter> | null;
  verificationLevel: VerificationLevel | null;
  rawUpdated: unknown;
};

export type DriftSnapshot = {
  pages: string[];
  pageEntries: DriftSnapshotPageEntry[];
};

export type DriftRow = {
  wikiPage: string; absolutePath: string; updated: string; sourcePaths: string[]; currentLevel: VerificationLevel | null;
  status: "fresh" | "stale" | "unknown" | "deleted" | "renamed";
  driftedSources: { path: string; lastModified: string }[]; renamedSources: { from: string; to: string }[]; deletedSources: string[]; errors: string[];
};

export type DriftSummary = { project: string; repo: string; totalWikiPages: number; pagesWithSourcePaths: number; unboundPages: string[]; fresh: number; stale: number; unknown: number; deleted: number; renamed: number; results: DriftRow[] };

export async function collectDriftSummary(project: string, explicitRepo: string | undefined, snapshot: DriftSnapshot): Promise<DriftSummary> {
  requireValue(project, "project");
  const repoPath = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repoPath);
  let boundCount = 0, freshCount = 0, staleCount = 0, unknownCount = 0, deletedCount = 0, renamedCount = 0;
  const results: DriftRow[] = [];
  const unboundPages: string[] = [];
  const entries: Array<{ file: string; relPath: string; sourcePaths: string[]; wikiUpdated: Date | null; currentLevel: VerificationLevel | null; rawUpdated: unknown }> = [];
  const allSourcePaths = new Set<string>();
  for (const entry of snapshot.pageEntries) {
    if (!entry.parsed) continue;
    if (!entry.sourcePaths.length) { unboundPages.push(entry.relPath); continue; }
    boundCount += 1;
    for (const sourcePath of entry.sourcePaths) allSourcePaths.add(sourcePath);
    entries.push({ file: entry.file, relPath: entry.relPath, sourcePaths: entry.sourcePaths, wikiUpdated: parseUpdatedDate(entry.rawUpdated), currentLevel: entry.verificationLevel, rawUpdated: entry.rawUpdated });
  }
  const gitDates = await batchGitLastModified(repoPath, [...allSourcePaths]);
  const sourceStatusCache = new Map<string, Awaited<ReturnType<typeof sourcePathStatus>>>();
  for (const entry of entries) {
    if (!entry.wikiUpdated) {
      results.push({ wikiPage: entry.relPath, absolutePath: entry.file, updated: String(entry.rawUpdated ?? "missing"), sourcePaths: entry.sourcePaths, currentLevel: entry.currentLevel, status: "unknown", driftedSources: [], renamedSources: [], deletedSources: [], errors: ["unable to parse updated date from frontmatter"] });
      unknownCount += 1; continue;
    }
    const driftedSources: { path: string; lastModified: string }[] = [];
    const renamedSources: { from: string; to: string }[] = [];
    const deletedSources: string[] = [];
    const errors: string[] = [];
    for (const sourcePath of entry.sourcePaths) {
      const fileStatus = sourceStatusCache.get(sourcePath) ?? await sourcePathStatus(repoPath, sourcePath);
      sourceStatusCache.set(sourcePath, fileStatus);
      if (fileStatus.kind === "renamed") { renamedSources.push({ from: sourcePath, to: fileStatus.renamedTo }); continue; }
      if (fileStatus.kind === "deleted") { deletedSources.push(sourcePath); continue; }
      if (fileStatus.kind === "missing") { errors.push(`missing source file: ${sourcePath}`); continue; }
      const gitDate = gitDates.get(sourcePath) ?? null;
      if (!gitDate) { errors.push(`no git history for: ${sourcePath}`); continue; }
      if (gitDate > entry.wikiUpdated) driftedSources.push({ path: sourcePath, lastModified: gitDate.toISOString().slice(0, 10) });
    }
    let status: DriftRow["status"] = "fresh";
    if (renamedSources.length > 0) status = "renamed";
    else if (deletedSources.length > 0) status = "deleted";
    else if (errors.length > 0 && driftedSources.length === 0) status = "unknown";
    else if (driftedSources.length > 0) status = "stale";
    if (status === "stale") staleCount += 1; else if (status === "fresh") freshCount += 1; else if (status === "deleted") deletedCount += 1; else if (status === "renamed") renamedCount += 1; else unknownCount += 1;
    results.push({ wikiPage: entry.relPath, absolutePath: entry.file, updated: entry.wikiUpdated.toISOString().slice(0, 10), sourcePaths: entry.sourcePaths, currentLevel: entry.currentLevel, status, driftedSources, renamedSources, deletedSources, errors });
  }
  return { project, repo: repoPath, totalWikiPages: snapshot.pages.length, pagesWithSourcePaths: boundCount, unboundPages: unboundPages.sort(), fresh: freshCount, stale: staleCount, unknown: unknownCount, deleted: deletedCount, renamed: renamedCount, results };
}
