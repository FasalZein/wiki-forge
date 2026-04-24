import { parseProjectRepoBaseArgs } from "../../git-utils";
import { collectHierarchyStatusActions, collectLifecycleDriftActions, collectCancelledSyncActions } from "../../hierarchy";
import { classifyDiagnosticFindings, isHardDiagnostic, groupDiagnosticFindings, type DiagnosticFinding, type DiagnosticScope, type MaintenanceAction } from "../shared";
import { readFlagValue } from "../../lib/cli-utils";
import { collectLintResult, collectSemanticLintResult } from "../../verification";
import type { LintingSnapshot } from "../../verification";
import { classifySliceLocalPageScope, collectSliceLocalContext, fileMatchesSliceClaims } from "../../slice/docs";
import { printJson, printLine } from "../../lib/cli-output";
import {
  loadProjectSnapshot,
  projectSnapshotToLintingSnapshot,
  collectRefreshFromGit,
  collectRefreshFromWorktree,
  type ProjectSnapshot,
  type RefreshOptions,
  type WorktreeImpactedPage,
} from "../shared";
import { collectDriftSummary } from "../drift";
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
  if (json) printJson({ ...compactCloseoutForJson(result), indexRefresh });
  else {
    renderCloseout(result, verbose);
    if (indexRefresh.stale.length) {
      printLine(dryRun
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
  const [drift, lint, semanticLint, initialHierarchyActions, initialLifecycleDriftActions, cancelledSyncActions] = await Promise.all([
    collectDriftSummary(project, explicitRepo, lintingState),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
    collectHierarchyStatusActions(project),
    collectLifecycleDriftActions(project),
    collectCancelledSyncActions(project),
  ]);
  // Apply cascade-refresh actions (Behavior A, PRD-057): stamp updated: + verified_against:
  // for pages whose source_paths all still hash to their verified_against sha.
  // cascadeRefreshActions is only produced by collectRefreshFromGit (not worktree).
  const cascadeRefreshActions = "cascadeRefreshActions" in refreshFromGit
    ? (refreshFromGit as { cascadeRefreshActions: MaintenanceAction[] }).cascadeRefreshActions
    : [];
  for (const action of cascadeRefreshActions) {
    if (action._apply) await action._apply();
  }
  // Apply cancel-sync actions (Behavior B, PRD-057): rewrite backlog row marker to [-]
  // for slices that are cancelled in the hub but still have an open row.
  for (const action of cancelledSyncActions) {
    if (action._apply) await action._apply();
  }
  // Apply-then-collect ordering (PRD-055):
  let hierarchyActions = initialHierarchyActions;
  let lifecycleDriftActions = initialLifecycleDriftActions;
  const anyLifecycleApplied = initialLifecycleDriftActions.some((a) => !!a._apply);
  if (anyLifecycleApplied || initialHierarchyActions.some((a) => !!a._apply)) {
    for (const action of initialLifecycleDriftActions) action._apply?.();
    const freshHierarchyActions = anyLifecycleApplied ? await collectHierarchyStatusActions(project) : initialHierarchyActions;
    for (const action of freshHierarchyActions) action._apply?.();
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
  const classifiedFindings = classifyDiagnosticFindings(findings);
  const blockers = classifiedFindings.filter(isHardDiagnostic).map((finding) => finding.message);
  const warnings = classifiedFindings.filter((finding) => !isHardDiagnostic(finding)).map((finding) => finding.message);
  const diagnostics = groupDiagnosticFindings(classifiedFindings);
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
    findings: classifiedFindings,
    diagnostics,
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
  printLine(`closeout for ${result.project}: ${statusLabel}`);
  printLine(`- repo: ${result.repo}`);
  printLine(`- base: ${result.base}`);
  printLine(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
  printLine(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
  if (result.staleImpactedPages.length) {
    printLine(`- stale impacted pages: ${result.staleImpactedPages.length} ⚠ (update and verify-page before closing)`);
  } else {
    printLine(`- stale impacted pages: 0`);
  }
  if (result.suppressedPages.length) printLine(`- suppressed historical done-slice pages: ${result.suppressedPages.length}`);
  printLine(`- lint: ${result.lint.issues.length}`);
  printLine(`- semantic: ${result.semanticLint.issues.length}`);
  printLine(`- missing tests: ${result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length}`);
  if (result.diagnostics.blockers.length) {
    printLine(`- blockers:`);
    for (const finding of result.diagnostics.blockers) printLine(`  - [hard][${finding.scope}] ${finding.message}`);
  }
  if (result.diagnostics.actionableWarnings.length) {
    printLine(`- actionable warnings:`);
    for (const finding of result.diagnostics.actionableWarnings) printLine(`  - [soft][${finding.scope}] ${finding.message}`);
  }
  if (result.diagnostics.projectDebtWarnings.length && !verbose) {
    printLine(`- project debt warnings: ${result.diagnostics.projectDebtWarnings.length} (use --verbose to expand)`);
  }
  if (result.diagnostics.historicalWarnings.length && !verbose) {
    printLine(`- historical warnings: ${result.diagnostics.historicalWarnings.length} (use --verbose to expand)`);
  }
  if (verbose) {
    for (const page of result.refreshFromGit.impactedPages.slice(0, 20)) printLine(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const finding of result.findings) printLine(`  - [${finding.blockingSeverity}][${finding.scope}][${finding.severity}] ${finding.message}`);
  }
  if (result.nextSteps.length) {
    printLine(`- manual steps before closing:`);
    for (const step of result.nextSteps) printLine(`  - ${step}`);
  }
}
