import { requireValue } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { collectLintResult, loadLintingSnapshot } from "../verification";
import { parseProjectRepoBaseArgs, findProjectArg } from "../git-utils";
import { collectDriftSummary } from "./drift";
import { collectRefreshFromGit } from "./_shared";
import { collectGate } from "./gate";

export async function refreshProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const lintingSnapshot = await loadLintingSnapshot(project, { noteIndex: true });
  const drift = await collectDriftSummary(project, repo, lintingSnapshot);
  const lint = await collectLintResult(project, lintingSnapshot);
  appendLogEntry("refresh", project, { project, details: [`stale=${drift.stale}`, `deleted=${drift.deleted}`, `unknown=${drift.unknown}`, `unbound=${drift.unboundPages.length}`, `lint_issues=${lint.issues.length}`] });
  const result = { project, repo: drift.repo, drift: { fresh: drift.fresh, stale: drift.stale, deleted: drift.deleted, unknown: drift.unknown, unbound: drift.unboundPages.length }, lint: { ok: lint.issues.length === 0, issues: lint.issues } };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`refresh summary for ${project}:`);
    console.log(`- repo: ${drift.repo}`);
    console.log(`- drift: fresh=${drift.fresh} stale=${drift.stale} deleted=${drift.deleted} unknown=${drift.unknown} unbound=${drift.unboundPages.length}`);
    console.log(`- lint issues: ${lint.issues.length}`);
    if (drift.stale || drift.deleted || drift.unknown) console.log(`- run: wiki drift-check ${project} --show-unbound`);
    if (lint.issues.length) console.log(`- run: wiki lint ${project}`);
    if (!drift.stale && !drift.deleted && !drift.unknown && !lint.issues.length) console.log(`- docs look current`);
  }
}

export async function refreshFromGit(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectRefreshFromGit(options.project, options.base, options.repo);
  appendLogEntry("refresh-from-git", options.project, { project: options.project, details: [`base=${result.base}`, `changed=${result.changedFiles.length}`, `impacted=${result.impactedPages.length}`, `uncovered=${result.uncoveredFiles.length}`, `missing_tests=${result.testHealth.codeFilesWithoutChangedTests.length}`] });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`refresh-from-git for ${options.project}:`);
    console.log(`- repo: ${result.repo}`);
    console.log(`- base: ${result.base}`);
    console.log(`- changed files: ${result.changedFiles.length}`);
    console.log(`- impacted pages: ${result.impactedPages.length}`);
    console.log(`- uncovered files: ${result.uncoveredFiles.length}`);
    console.log(`- changed tests: ${result.testHealth.changedTestFiles.length}`);
    console.log(`- code changes without changed tests: ${result.testHealth.codeFilesWithoutChangedTests.length}`);
    for (const page of result.impactedPages) {
      console.log(`  - ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
      if (verbose) {
        for (const line of page.diffSummary.slice(0, 3)) console.log(`    ${line}`);
      }
    }
    if (result.uncoveredFiles.length) {
      console.log(`- uncovered:`);
      for (const file of result.uncoveredFiles) console.log(`  - ${file}`);
    }
    if (result.testHealth.codeFilesWithoutChangedTests.length) {
      console.log(`- missing test companion changes:`);
      for (const file of result.testHealth.codeFilesWithoutChangedTests) console.log(`  - ${file}`);
    }
  }
}

export async function refreshOnMerge(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectRefreshOnMerge(options.project, options.base, options.repo);
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderRefreshOnMerge(result, verbose);
  if (!result.ok) throw new Error(`refresh-on-merge failed for ${options.project}`);
}

async function collectRefreshOnMerge(project: string, base: string, explicitRepo?: string) {
  const refresh = await collectRefreshFromGit(project, base, explicitRepo);
  const drift = await collectDriftSummary(project, explicitRepo);
  const gate = await collectGate(project, base, explicitRepo);
  const impacted = new Set(refresh.impactedPages.map((page) => page.page));
  const staleImpactedPages = drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  return { project, repo: refresh.repo, base, ok: gate.ok && staleImpactedPages.length === 0, changedFiles: refresh.changedFiles, impactedPages: refresh.impactedPages, staleImpactedPages, uncoveredFiles: refresh.uncoveredFiles, gate };
}

type RefreshOnMergeResult = Awaited<ReturnType<typeof collectRefreshOnMerge>>;

function renderRefreshOnMerge(result: RefreshOnMergeResult, verbose: boolean) {
  console.log(`refresh-on-merge for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  console.log(`- changed files: ${result.changedFiles.length}`);
  console.log(`- impacted pages: ${result.impactedPages.length}`);
  console.log(`- stale impacted pages: ${result.staleImpactedPages.length}`);
  console.log(`- gate: ${result.gate.ok ? "PASS" : "FAIL"}`);
  if (verbose || !result.ok) {
    for (const page of result.impactedPages.slice(0, 20)) console.log(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const row of result.staleImpactedPages.slice(0, 20)) console.log(`  - stale: ${row.wikiPage} [${row.status}]`);
    for (const blocker of result.gate.blockers) console.log(`  - blocker: ${blocker}`);
    for (const warning of result.gate.warnings.slice(0, 20)) console.log(`  - warning: ${warning}`);
  }
}
