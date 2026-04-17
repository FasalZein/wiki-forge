import { parseProjectRepoBaseArgs } from "../git-utils";
import { collectLintResult, collectSemanticLintResult } from "../verification/linting";
import type { LintingSnapshot } from "../verification/linting";
import {
  loadProjectSnapshot,
  projectSnapshotToLintingSnapshot,
  collectRefreshFromGit,
  collectRefreshFromWorktree,
  type ProjectSnapshot,
  type RefreshOptions,
  type WorktreeImpactedPage,
} from "./_shared";
import { collectDriftSummary } from "./drift";
import { autoRefreshIndex } from "./maintain";

export async function closeoutProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const worktree = args.includes("--worktree");
  const dryRun = args.includes("--dry-run");
  const indexRefresh = await autoRefreshIndex(options.project, { dryRun });
  const result = await collectCloseout(options.project, options.base, options.repo, undefined, undefined, { worktree });
  if (json) console.log(JSON.stringify({ ...compactCloseoutForJson(result), indexRefresh }, null, 2));
  else {
    renderCloseout(result, verbose);
    if (indexRefresh.stale.length) {
      console.log(dryRun
        ? `- index refresh: ${indexRefresh.stale.length} stale (dry-run; skipped)`
        : `- index refresh: ${indexRefresh.written.length} file(s) rewritten`);
    }
  }
  if (!result.ok) throw new Error(`closeout failed for ${options.project}`);
}

export async function collectCloseout(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.worktree
    ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
    : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot);
  const [drift, lint, semanticLint] = await Promise.all([
    collectDriftSummary(project, explicitRepo, lintingState),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
  ]);
  const impacted = new Set(refreshFromGit.impactedPages.map((page) => page.page));
  const staleImpactedPages = options.worktree
    ? (refreshFromGit.impactedPages as WorktreeImpactedPage[])
      .filter((page) => "stale" in page && page.stale)
      .map((page) => ({ wikiPage: page.page, status: "stale", pageUpdated: page.pageUpdated, lastSourceChange: page.lastSourceChange }))
    : drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  const blockers: string[] = [];
  if (refreshFromGit.testHealth.codeFilesWithoutChangedTests.length > 0) blockers.push(`${refreshFromGit.testHealth.codeFilesWithoutChangedTests.length} changed code file(s) have no matching changed tests`);
  if (options.worktree && staleImpactedPages.length > 0) blockers.push(`${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`);
  const warnings: string[] = [];
  if (lint.issues.length > 0) warnings.push(`${lint.issues.length} structural lint issue(s)`);
  if (semanticLint.issues.length > 0) warnings.push(`${semanticLint.issues.length} semantic lint issue(s)`);
  if (!options.worktree && staleImpactedPages.length > 0) warnings.push(`${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`);
  if (refreshFromGit.uncoveredFiles.length > 0) warnings.push(`${refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings`);
  const suppressedPages = options.worktree && "suppressedPages" in refreshFromGit ? (refreshFromGit as { suppressedPages: WorktreeImpactedPage[] }).suppressedPages : [];
  const outsideActiveHierarchyFiles = options.worktree && "outsideActiveHierarchyFiles" in refreshFromGit ? (refreshFromGit as { outsideActiveHierarchyFiles: string[] }).outsideActiveHierarchyFiles : [];
  if (suppressedPages.length > 0) warnings.push(`${suppressedPages.length} non-actionable planning page(s) suppressed from stale check`);
  if (outsideActiveHierarchyFiles.length > 0) warnings.push(`${outsideActiveHierarchyFiles.length} changed code file(s) belong to non-actionable planning pages outside the active slice hierarchy`);
  const nextSteps: string[] = [];
  if (staleImpactedPages.length > 0) {
    nextSteps.push(`update impacted wiki pages from code`);
    nextSteps.push(`wiki verify-page ${project} <page...> <level>`);
    nextSteps.push(
      options.worktree
        ? `re-run wiki closeout ${project} --repo ${refreshFromGit.repo} --worktree`
        : `re-run wiki closeout ${project} --repo ${refreshFromGit.repo} --base ${base}`,
    );
  }
  return {
    project,
    repo: refreshFromGit.repo,
    base: options.worktree ? "WORKTREE" : base,
    ok: blockers.length === 0,
    refreshFromGit,
    drift,
    staleImpactedPages,
    suppressedPages,
    outsideActiveHierarchyFiles,
    lint,
    semanticLint,
    blockers,
    warnings,
    nextSteps,
  };
}

export function compactCloseoutForJson(result: Awaited<ReturnType<typeof collectCloseout>>) {
  const MAX_DRIFT_ROWS = 30;
  const driftedRows = result.drift.results.filter((row) => row.status !== "fresh");
  const truncatedDrift = driftedRows.length > MAX_DRIFT_ROWS;
  return {
    ...result,
    drift: {
      ...result.drift,
      results: driftedRows.slice(0, MAX_DRIFT_ROWS).map(({ absolutePath, ...row }) => row),
      ...(truncatedDrift ? { truncated: true, totalDrifted: driftedRows.length } : {}),
    },
  };
}

export function renderCloseout(result: Awaited<ReturnType<typeof collectCloseout>>, verbose: boolean) {
  const hasWork = result.staleImpactedPages.length > 0 || result.nextSteps.length > 0;
  const statusLabel = !result.ok
    ? "FAIL (blockers found)"
    : hasWork
      ? "REVIEW PASS — manual steps remaining"
      : "PASS — ready to close";
  console.log(`closeout for ${result.project}: ${statusLabel}`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
  console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
  if (result.staleImpactedPages.length) {
    console.log(`- stale impacted pages: ${result.staleImpactedPages.length} ⚠ (update and verify-page before closing)`);
  } else {
    console.log(`- stale impacted pages: 0`);
  }
  if (result.suppressedPages.length) console.log(`- suppressed historical done-slice pages: ${result.suppressedPages.length}`);
  console.log(`- lint: ${result.lint.issues.length}`);
  console.log(`- semantic: ${result.semanticLint.issues.length}`);
  console.log(`- missing tests: ${result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length}`);
  if (verbose || !result.ok) {
    for (const page of result.refreshFromGit.impactedPages.slice(0, 20)) console.log(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const blocker of result.blockers) console.log(`  - blocker: ${blocker}`);
    for (const warning of result.warnings) console.log(`  - warning: ${warning}`);
  }
  if (result.nextSteps.length) {
    console.log(`- manual steps before closing:`);
    for (const step of result.nextSteps) console.log(`  - ${step}`);
  }
}
