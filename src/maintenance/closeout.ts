import { parseProjectRepoBaseArgs } from "../git-utils";
import { collectHierarchyStatusActions, collectLifecycleDriftActions } from "../hierarchy";
import type { DiagnosticFinding, DiagnosticScope } from "../lib/diagnostics";
import { collectSliceLocalContext, classifySliceLocalPageScope, fileMatchesSliceClaims } from "../lib/slice-local";
import { readFlagValue } from "../lib/cli-utils";
import { collectLintResult, collectSemanticLintResult } from "../verification";
import type { LintingSnapshot } from "../verification";
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
  const sliceLocal = args.includes("--slice-local");
  const sliceId = readFlagValue(args, "--slice-id");
  const indexRefresh = await autoRefreshIndex(options.project, { dryRun });
  const result = await collectCloseout(options.project, options.base, options.repo, undefined, undefined, { worktree, sliceLocal, sliceId });
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

export async function collectCloseout(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions & { sliceLocal?: boolean; sliceId?: string } = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.worktree
    ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
    : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot);
  const [drift, lint, semanticLint, initialHierarchyActions, initialLifecycleDriftActions] = await Promise.all([
    collectDriftSummary(project, explicitRepo, lintingState),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
    collectHierarchyStatusActions(project),
    collectLifecycleDriftActions(project),
  ]);
  // Apply-then-collect ordering (PRD-055):
  //  1. Apply R2/R3 lifecycle drift actions (rewrites status/reopened_reason/superseded_by).
  //  2. Re-collect R1 (hierarchy status) with fresh closures so R1 doesn't overwrite R2's writes.
  //  3. Apply fresh R1 (writes computed_status on updated pages).
  //  4. Re-collect both to get post-heal state for the findings flatten pass.
  // This guarantees auto-healed actions never appear as warnings in the same run.
  let hierarchyActions = initialHierarchyActions;
  let lifecycleDriftActions = initialLifecycleDriftActions;
  const anyLifecycleApplied = initialLifecycleDriftActions.some((a) => !!a._apply);
  if (anyLifecycleApplied || initialHierarchyActions.some((a) => !!a._apply)) {
    // Step 1: apply R2/R3 (lifecycle drift with _apply)
    for (const action of initialLifecycleDriftActions) action._apply?.();
    // Step 2: re-collect R1 with fresh closures (post R2/R3 disk state)
    const freshHierarchyActions = anyLifecycleApplied ? await collectHierarchyStatusActions(project) : initialHierarchyActions;
    // Step 3: apply fresh R1
    for (const action of freshHierarchyActions) action._apply?.();
    // Step 4: re-collect both to get post-heal state for findings
    [hierarchyActions, lifecycleDriftActions] = await Promise.all([
      collectHierarchyStatusActions(project),
      collectLifecycleDriftActions(project),
    ]);
  }
  const impacted = new Set(refreshFromGit.impactedPages.map((page) => page.page));
  const sliceLocalContext = options.sliceLocal && options.sliceId
    ? await collectSliceLocalContext(project, options.sliceId, projectSnapshot.pageEntries)
    : null;
  const staleImpactedPages = options.worktree
    ? (refreshFromGit.impactedPages as WorktreeImpactedPage[])
      .filter((page) => "stale" in page && page.stale)
      .map((page) => ({ wikiPage: page.page, status: "stale", pageUpdated: page.pageUpdated, lastSourceChange: page.lastSourceChange }))
    : drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  const findings: DiagnosticFinding[] = [];
  if (sliceLocalContext) {
    pushScopedFileFindings(findings, refreshFromGit.testHealth.codeFilesWithoutChangedTests, sliceLocalContext, "changed code file(s) have no matching changed tests", "blocker");
    pushScopedStalePageFindings(findings, staleImpactedPages, sliceLocalContext);
  } else {
    if (refreshFromGit.testHealth.codeFilesWithoutChangedTests.length > 0) findings.push({ scope: "slice", severity: "blocker", message: `${refreshFromGit.testHealth.codeFilesWithoutChangedTests.length} changed code file(s) have no matching changed tests` });
    if (options.worktree && staleImpactedPages.length > 0) findings.push({ scope: "slice", severity: "blocker", message: `${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted` });
  }
  if (lint.issues.length > 0) findings.push({ scope: "project", severity: "warning", message: `${lint.issues.length} structural lint issue(s)` });
  if (semanticLint.issues.length > 0) findings.push({ scope: "project", severity: "warning", message: `${semanticLint.issues.length} semantic lint issue(s)` });
  if (!options.worktree && !sliceLocalContext && staleImpactedPages.length > 0) findings.push({ scope: "slice", severity: "warning", message: `${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted` });
  if (sliceLocalContext) pushScopedFileFindings(findings, refreshFromGit.uncoveredFiles, sliceLocalContext, "changed file(s) are not covered by wiki bindings", "warning");
  else if (refreshFromGit.uncoveredFiles.length > 0) findings.push({ scope: "slice", severity: "warning", message: `${refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings` });
  const suppressedPages = options.worktree && "suppressedPages" in refreshFromGit ? (refreshFromGit as { suppressedPages: WorktreeImpactedPage[] }).suppressedPages : [];
  const outsideActiveHierarchyFiles = options.worktree && "outsideActiveHierarchyFiles" in refreshFromGit ? (refreshFromGit as { outsideActiveHierarchyFiles: string[] }).outsideActiveHierarchyFiles : [];
  if (suppressedPages.length > 0) findings.push({ scope: "history", severity: "warning", message: `${suppressedPages.length} non-actionable planning page(s) suppressed from stale check` });
  if (outsideActiveHierarchyFiles.length > 0) findings.push({ scope: "history", severity: "warning", message: `${outsideActiveHierarchyFiles.length} changed code file(s) belong to non-actionable planning pages outside the active slice hierarchy` });
  for (const action of hierarchyActions) findings.push({ scope: "parent", severity: "warning", message: action.message });
  for (const action of lifecycleDriftActions) findings.push({ scope: "parent", severity: "warning", message: action.message });
  const blockers = findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.message);
  const warnings = findings.filter((finding) => finding.severity === "warning").map((finding) => finding.message);
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
    findings,
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

function pushScopedFileFindings(
  findings: DiagnosticFinding[],
  files: string[],
  context: Awaited<ReturnType<typeof collectSliceLocalContext>>,
  messageSuffix: string,
  sliceSeverity: "blocker" | "warning",
) {
  const sliceFiles = files.filter((file) => fileMatchesSliceClaims(file, context));
  const historyFiles = files.filter((file) => !fileMatchesSliceClaims(file, context));
  if (sliceFiles.length > 0) findings.push({ scope: "slice", severity: sliceSeverity, message: `${sliceFiles.length} ${messageSuffix}` });
  if (historyFiles.length > 0) findings.push({ scope: "history", severity: "warning", message: `${historyFiles.length} changed file(s) outside the active slice also need attention` });
}

function pushScopedStalePageFindings(
  findings: DiagnosticFinding[],
  stalePages: Array<{ wikiPage: string }>,
  context: Awaited<ReturnType<typeof collectSliceLocalContext>>,
) {
  const counts = new Map<DiagnosticScope, number>();
  for (const page of stalePages) {
    const scope = classifySliceLocalPageScope(page.wikiPage, context);
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  const sliceCount = counts.get("slice") ?? 0;
  const parentCount = counts.get("parent") ?? 0;
  const projectCount = counts.get("project") ?? 0;
  if (sliceCount > 0) findings.push({ scope: "slice", severity: "blocker", message: `${sliceCount} impacted slice page(s) are stale or otherwise drifted` });
  if (parentCount > 0) findings.push({ scope: "parent", severity: "warning", message: `${parentCount} impacted parent page(s) are stale or otherwise drifted` });
  if (projectCount > 0) findings.push({ scope: "project", severity: "warning", message: `${projectCount} impacted project page(s) are stale or otherwise drifted` });
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
    for (const finding of result.findings) console.log(`  - [${finding.scope}][${finding.severity}] ${finding.message}`);
  }
  if (result.nextSteps.length) {
    console.log(`- manual steps before closing:`);
    for (const step of result.nextSteps) console.log(`  - ${step}`);
  }
}
