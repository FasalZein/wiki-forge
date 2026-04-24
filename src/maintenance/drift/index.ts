import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, requireValue, safeMatter, today, writeNormalizedPage } from "../../cli-shared";
import { readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { readVerificationLevel } from "../../lib/verification";
import { loadLintingSnapshot } from "../../verification";
import { collectDriftSummary, type DriftSummary } from "./query";
import { printJson, printLine } from "../../lib/cli-output";

export { collectDriftSummary } from "./query";
export type { DriftSummary } from "./query";

export async function driftCheck(args: string[]) {
  const options = parseDriftCheckArgs(args);
  requireValue(options.project, "project");
  const snapshot = await loadLintingSnapshot(options.project);
  const summary = await collectDriftSummary(options.project, options.repo, snapshot);
  if (options.json) printJson(summary);
  else renderDriftSummary(summary, options.showUnbound);
  if (!options.autoFix) return;
  let fixed = 0;
  for (const result of summary.results) {
    if (result.status !== "stale" && result.status !== "deleted") continue;
    const parsed = safeMatter(relative(VAULT_ROOT, result.absolutePath), await readText(result.absolutePath));
    if (!parsed) continue;
    writeNormalizedPage(result.absolutePath, parsed.content, { ...parsed.data, verification_level: "stale", previous_level: readVerificationLevel(parsed.data) ?? undefined, stale_since: today(), updated: nowIso() });
    fixed += 1;
    if (!options.json) printLine(`  -> auto-demoted ${result.wikiPage} to stale`);
  }
  appendLogEntry("drift-fix", summary.project, { project: summary.project, details: [`fixed=${fixed}`, `stale=${summary.stale}`, `deleted=${summary.deleted}`] });
}

function renderDriftSummary(summary: DriftSummary, showUnbound: boolean) {
  printLine(`drift-check for ${summary.project}:`);
  printLine(`  total wiki pages: ${summary.totalWikiPages}`);
  printLine(`  pages with source_paths: ${summary.pagesWithSourcePaths}`);
  printLine(`  unbound pages: ${summary.unboundPages.length}`);
  printLine(`  fresh: ${summary.fresh}  stale: ${summary.stale}  renamed: ${summary.renamed}  deleted: ${summary.deleted}  unknown: ${summary.unknown}`);
  printLine(`  repo: ${summary.repo}\n`);
  if (!summary.results.length) printLine("no pages have source_paths bindings — run 'wiki bind' to add them");
  for (const result of summary.results) {
    printLine(`[${result.status}] ${result.wikiPage} [${result.currentLevel ?? "untracked"}]  (updated: ${result.updated})`);
    for (const source of result.driftedSources) printLine(`  - drifted: ${source.path} (git: ${source.lastModified})`);
    for (const source of result.renamedSources) printLine(`  - renamed source: ${source.from} -> ${source.to}`);
    for (const source of result.deletedSources) printLine(`  - deleted source: ${source}`);
    for (const error of result.errors) printLine(`  - ${error}`);
  }
  if (showUnbound && summary.unboundPages.length) {
    printLine("\nunbound pages:");
    for (const page of summary.unboundPages) printLine(`  - ${page}`);
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
