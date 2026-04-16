import { relative } from "node:path";
import { VAULT_ROOT, type VerificationLevel } from "../constants";
import { assertExists, nowIso, projectRoot, requireValue, safeMatter, today, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { batchGitLastModified, parseUpdatedDate, readVerificationLevel, resolveRepoPath, assertGitRepo, sourcePathStatus } from "../lib/verification";
import { loadLintingSnapshot } from "./linting";
import type { LintingSnapshot } from "./linting";

type DriftRow = {
  wikiPage: string; absolutePath: string; updated: string; sourcePaths: string[]; currentLevel: VerificationLevel | null;
  status: "fresh" | "stale" | "unknown" | "deleted" | "renamed";
  driftedSources: { path: string; lastModified: string }[]; renamedSources: { from: string; to: string }[]; deletedSources: string[]; errors: string[];
};

type DriftSummary = { project: string; repo: string; totalWikiPages: number; pagesWithSourcePaths: number; unboundPages: string[]; fresh: number; stale: number; unknown: number; deleted: number; renamed: number; results: DriftRow[] };

export async function driftCheck(args: string[]) {
  const options = parseDriftCheckArgs(args);
  const summary = await collectDriftSummary(options.project, options.repo);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else renderDriftSummary(summary, options.showUnbound);
  if (!options.autoFix) return;
  let fixed = 0;
  for (const result of summary.results) {
    if (result.status !== "stale" && result.status !== "deleted") continue;
    const parsed = safeMatter(relative(VAULT_ROOT, result.absolutePath), await readText(result.absolutePath));
    if (!parsed) continue;
    writeNormalizedPage(result.absolutePath, parsed.content, { ...parsed.data, verification_level: "stale", previous_level: readVerificationLevel(parsed.data) ?? undefined, stale_since: today(), updated: nowIso() });
    fixed += 1;
    if (!options.json) console.log(`  -> auto-demoted ${result.wikiPage} to stale`);
  }
  appendLogEntry("drift-fix", summary.project, { project: summary.project, details: [`fixed=${fixed}`, `stale=${summary.stale}`, `deleted=${summary.deleted}`] });
}

export async function collectDriftSummary(project: string, explicitRepo?: string, snapshot?: LintingSnapshot): Promise<DriftSummary> {
  requireValue(project, "project");
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const repoPath = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repoPath);
  const state = snapshot ?? await loadLintingSnapshot(project);
  let boundCount = 0, freshCount = 0, staleCount = 0, unknownCount = 0, deletedCount = 0, renamedCount = 0;
  const results: DriftRow[] = [];
  const unboundPages: string[] = [];
  const entries: Array<{ file: string; relPath: string; sourcePaths: string[]; wikiUpdated: Date | null; currentLevel: VerificationLevel | null; rawUpdated: unknown }> = [];
  const allSourcePaths = new Set<string>();
  for (const entry of state.pageEntries) {
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
    const status: DriftRow["status"] = renamedSources.length > 0 ? "renamed" : deletedSources.length > 0 ? "deleted" : errors.length > 0 && driftedSources.length === 0 ? "unknown" : driftedSources.length > 0 ? "stale" : "fresh";
    if (status === "stale") staleCount += 1; else if (status === "fresh") freshCount += 1; else if (status === "deleted") deletedCount += 1; else if (status === "renamed") renamedCount += 1; else unknownCount += 1;
    results.push({ wikiPage: entry.relPath, absolutePath: entry.file, updated: entry.wikiUpdated.toISOString().slice(0, 10), sourcePaths: entry.sourcePaths, currentLevel: entry.currentLevel, status, driftedSources, renamedSources, deletedSources, errors });
  }
  return { project, repo: repoPath, totalWikiPages: state.pages.length, pagesWithSourcePaths: boundCount, unboundPages: unboundPages.sort(), fresh: freshCount, stale: staleCount, unknown: unknownCount, deleted: deletedCount, renamed: renamedCount, results };
}

function renderDriftSummary(summary: DriftSummary, showUnbound: boolean) {
  console.log(`drift-check for ${summary.project}:`);
  console.log(`  total wiki pages: ${summary.totalWikiPages}`);
  console.log(`  pages with source_paths: ${summary.pagesWithSourcePaths}`);
  console.log(`  unbound pages: ${summary.unboundPages.length}`);
  console.log(`  fresh: ${summary.fresh}  stale: ${summary.stale}  renamed: ${summary.renamed}  deleted: ${summary.deleted}  unknown: ${summary.unknown}`);
  console.log(`  repo: ${summary.repo}\n`);
  if (!summary.results.length) console.log("no pages have source_paths bindings — run 'wiki bind' to add them");
  for (const result of summary.results) {
    console.log(`[${result.status}] ${result.wikiPage} [${result.currentLevel ?? "untracked"}]  (updated: ${result.updated})`);
    for (const source of result.driftedSources) console.log(`  - drifted: ${source.path} (git: ${source.lastModified})`);
    for (const source of result.renamedSources) console.log(`  - renamed source: ${source.from} -> ${source.to}`);
    for (const source of result.deletedSources) console.log(`  - deleted source: ${source}`);
    for (const error of result.errors) console.log(`  - ${error}`);
  }
  if (showUnbound && summary.unboundPages.length) {
    console.log("\nunbound pages:");
    for (const page of summary.unboundPages) console.log(`  - ${page}`);
  }
}

function parseDriftCheckArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  if (repoIndex >= 0) requireValue(repo, "repo");
  return { project, repo, autoFix: args.includes("--fix"), showUnbound: args.includes("--show-unbound"), json: args.includes("--json") };
}
