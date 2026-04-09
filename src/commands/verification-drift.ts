import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT, type VerificationLevel } from "../constants";
import { assertExists, projectRoot, requireValue, safeMatter, today, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { batchGitLastModified, parseUpdatedDate, readVerificationLevel, resolveRepoPath, assertGitRepo, sourcePathStatus } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";

type DriftRow = {
  wikiPage: string; absolutePath: string; updated: string; sourcePaths: string[]; currentLevel: VerificationLevel | null;
  status: "fresh" | "stale" | "unknown" | "deleted" | "renamed";
  driftedSources: { path: string; lastModified: string }[]; renamedSources: { from: string; to: string }[]; deletedSources: string[]; errors: string[];
};

type DriftSummary = { project: string; repo: string; totalWikiPages: number; pagesWithSourcePaths: number; unboundPages: string[]; fresh: number; stale: number; unknown: number; deleted: number; renamed: number; results: DriftRow[] };

export function driftCheck(args: string[]) {
  const options = parseDriftCheckArgs(args);
  const summary = collectDriftSummary(options.project, options.repo);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else renderDriftSummary(summary, options.showUnbound);
  if (!options.autoFix) return;
  let fixed = 0;
  for (const result of summary.results) {
    if (result.status !== "stale" && result.status !== "deleted") continue;
    const parsed = safeMatter(relative(VAULT_ROOT, result.absolutePath), readFileSync(result.absolutePath, "utf8"));
    if (!parsed) continue;
    writeNormalizedPage(result.absolutePath, parsed.content, { ...parsed.data, verification_level: "stale", previous_level: readVerificationLevel(parsed.data) ?? undefined, stale_since: today(), updated: today() });
    fixed += 1;
    if (!options.json) console.log(`  -> auto-demoted ${result.wikiPage} to stale`);
  }
  appendLogEntry("drift-fix", summary.project, { project: summary.project, details: [`fixed=${fixed}`, `stale=${summary.stale}`, `deleted=${summary.deleted}`] });
}

export function collectDriftSummary(project: string, explicitRepo?: string): DriftSummary {
  requireValue(project, "project");
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const repoPath = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repoPath);
  let boundCount = 0, freshCount = 0, staleCount = 0, unknownCount = 0, deletedCount = 0, renamedCount = 0;
  const results: DriftRow[] = [];
  const allFiles = walkMarkdown(root);
  const unboundPages: string[] = [];
  const entries: Array<{ file: string; relPath: string; sourcePaths: string[]; wikiUpdated: Date | null; currentLevel: VerificationLevel | null; rawUpdated: unknown }> = [];
  const allSourcePaths = new Set<string>();
  for (const file of allFiles) {
    const parsed = safeMatter(relative(VAULT_ROOT, file), readFileSync(file, "utf8"), { silent: true });
    if (!parsed) continue;
    const sourcePaths = Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value) => String(value).replaceAll("\\", "/")) : [];
    if (!sourcePaths.length) { unboundPages.push(relative(root, file)); continue; }
    boundCount += 1;
    for (const sourcePath of sourcePaths) allSourcePaths.add(sourcePath);
    entries.push({ file, relPath: relative(root, file), sourcePaths, wikiUpdated: parseUpdatedDate(parsed.data.updated), currentLevel: readVerificationLevel(parsed.data), rawUpdated: parsed.data.updated });
  }
  const gitDates = batchGitLastModified(repoPath, [...allSourcePaths]);
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
      const fileStatus = sourcePathStatus(repoPath, sourcePath);
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
  return { project, repo: repoPath, totalWikiPages: allFiles.length, pagesWithSourcePaths: boundCount, unboundPages: unboundPages.sort(), fresh: freshCount, stale: staleCount, unknown: unknownCount, deleted: deletedCount, renamed: renamedCount, results };
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
