import { requireValue } from "../../cli-shared";
import { appendLogEntry } from "../../lib/log";
import { collectLintResult, loadLintingSnapshot } from "../../verification";
import { parseProjectRepoBaseArgs, findProjectArg } from "../../git-utils";
import { collectDriftSummary } from "../drift";
import { collectRefreshFromGit } from "../shared";
import { collectGate } from "../closeout/gate";
import { printJson, printLine } from "../../lib/cli-output";

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
  if (json) printJson(result);
  else {
    printLine(`refresh summary for ${project}:`);
    printLine(`- repo: ${drift.repo}`);
    printLine(`- drift: fresh=${drift.fresh} stale=${drift.stale} deleted=${drift.deleted} unknown=${drift.unknown} unbound=${drift.unboundPages.length}`);
    printLine(`- lint issues: ${lint.issues.length}`);
    if (drift.stale || drift.deleted || drift.unknown) printLine(`- run: wiki drift-check ${project} --show-unbound`);
    if (lint.issues.length) printLine(`- run: wiki lint ${project}`);
    if (!drift.stale && !drift.deleted && !drift.unknown && !lint.issues.length) printLine(`- docs look current`);
  }
}

export async function refreshFromGit(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectRefreshFromGit(options.project, options.base, options.repo);
  const cascadeRefreshActions = result.cascadeRefreshActions ?? []; // desloppify:ignore EMPTY_ARRAY_FALLBACK
  for (const action of cascadeRefreshActions) {
    if (action._apply) await action._apply();
  }
  appendLogEntry("refresh-from-git", options.project, { project: options.project, details: [`base=${result.base}`, `changed=${result.changedFiles.length}`, `impacted=${result.impactedPages.length}`, `cascade=${cascadeRefreshActions.length}`, `uncovered=${result.uncoveredFiles.length}`, `missing_tests=${result.testHealth.codeFilesWithoutChangedTests.length}`] });
  const compact = compactRefreshFromGitForJson(result);
  if (json) printJson({ ...compact, cascadeRefreshedPages: cascadeRefreshActions.map((action) => action.message) });
  else {
    printLine(`refresh-from-git for ${options.project}:`);
    printLine(`- repo: ${result.repo}`);
    printLine(`- base: ${result.base}`);
    printLine(`- changed files: ${result.changedFiles.length}`);
    printLine(`- impacted pages: ${result.impactedPages.length}`);
    printLine(`- cascade refreshed pages: ${cascadeRefreshActions.length}`);
    printLine(`- uncovered files: ${result.uncoveredFiles.length}`);
    printLine(`- changed tests: ${result.testHealth.changedTestFiles.length}`);
    printLine(`- code changes without changed tests: ${result.testHealth.codeFilesWithoutChangedTests.length}`);
    for (const page of result.impactedPages) {
      printLine(`  - ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
      if (verbose) {
        for (const line of page.diffSummary.slice(0, 3)) printLine(`    ${line}`);
      }
    }
    if (result.uncoveredFiles.length) {
      printLine(`- uncovered:`);
      for (const file of result.uncoveredFiles) printLine(`  - ${file}`);
    }
    if (result.testHealth.codeFilesWithoutChangedTests.length) {
      printLine(`- missing test companion changes:`);
      for (const file of result.testHealth.codeFilesWithoutChangedTests) printLine(`  - ${file}`);
    }
    if (cascadeRefreshActions.length) {
      printLine(`- auto-heal:`);
      for (const action of cascadeRefreshActions) printLine(`  - ${action.message}`);
    }
  }
}

export async function refreshOnMerge(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectRefreshOnMerge(options.project, options.base, options.repo);
  if (json) printJson(result);
  else renderRefreshOnMerge(result, verbose);
  if (!result.ok) throw new Error(`refresh-on-merge failed for ${options.project}`);
}

async function collectRefreshOnMerge(project: string, base: string, explicitRepo?: string) {
  const refresh = await collectRefreshFromGit(project, base, explicitRepo);
  const lintingSnapshot = await loadLintingSnapshot(project);
  const drift = await collectDriftSummary(project, explicitRepo, lintingSnapshot);
  const gate = await collectGate(project, base, explicitRepo);
  const impacted = new Set(refresh.impactedPages.map((page) => page.page));
  const staleImpactedPages = drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  return { project, repo: refresh.repo, base, ok: gate.ok && staleImpactedPages.length === 0, changedFiles: refresh.changedFiles, impactedPages: refresh.impactedPages, staleImpactedPages, uncoveredFiles: refresh.uncoveredFiles, gate };
}

type RefreshOnMergeResult = Awaited<ReturnType<typeof collectRefreshOnMerge>>;

function renderRefreshOnMerge(result: RefreshOnMergeResult, verbose: boolean) {
  printLine(`refresh-on-merge for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  printLine(`- repo: ${result.repo}`);
  printLine(`- base: ${result.base}`);
  printLine(`- changed files: ${result.changedFiles.length}`);
  printLine(`- impacted pages: ${result.impactedPages.length}`);
  printLine(`- stale impacted pages: ${result.staleImpactedPages.length}`);
  printLine(`- gate: ${result.gate.ok ? "PASS" : "FAIL"}`);
  if (verbose || !result.ok) {
    for (const page of result.impactedPages.slice(0, 20)) printLine(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const row of result.staleImpactedPages.slice(0, 20)) printLine(`  - stale: ${row.wikiPage} [${row.status}]`);
    for (const blocker of result.gate.blockers) printLine(`  - blocker: ${blocker}`);
    for (const warning of result.gate.warnings.slice(0, 20)) printLine(`  - warning: ${warning}`);
  }
}

function compactRefreshFromGitForJson(result: Awaited<ReturnType<typeof collectRefreshFromGit>>) {
  const MAX_IMPACTED = 25;
  const MAX_UNCOVERED = 50;
  const truncatedImpacted = result.impactedPages.length > MAX_IMPACTED;
  const truncatedUncovered = result.uncoveredFiles.length > MAX_UNCOVERED;
  return {
    ...result,
    impactedPages: result.impactedPages.slice(0, MAX_IMPACTED).map(({ diffSummary, ...page }) => page),
    ...(truncatedImpacted ? { impactedPagesTruncated: true, totalImpactedPages: result.impactedPages.length } : {}),
    uncoveredFiles: result.uncoveredFiles.slice(0, MAX_UNCOVERED),
    ...(truncatedUncovered ? { uncoveredFilesTruncated: true, totalUncoveredFiles: result.uncoveredFiles.length } : {}),
  };
}
