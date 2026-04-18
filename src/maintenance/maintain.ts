import { requireValue } from "../cli-shared";
import { formatMaintenanceActionLabel, type MaintenanceAction } from "../lib/diagnostics";
import { appendLogEntry } from "../lib/log";
import { collectLintResult, collectSemanticLintResult } from "../verification";
import type { LintingSnapshot } from "../verification";
import { parseProjectRepoBaseArgs } from "../git-utils";
import {
  collectHierarchyStatusActions,
  collectLifecycleDriftActions,
  collectCancelledSyncActions,
  collectStaleIndexTargets,
  writeNavigationIndex,
  collectBacklogFocus,
} from "../hierarchy";
import {
  loadProjectSnapshot,
  projectSnapshotToLintingSnapshot,
  collectRefreshFromGit,
  collectRefreshFromWorktree,
  type ProjectSnapshot,
  type RefreshOptions,
} from "./_shared";
import { collectDiscoverSummary } from "./discover";

export async function autoRefreshIndex(project: string, options: { dryRun?: boolean } = {}): Promise<{ stale: string[]; written: string[] }> {
  requireValue(project, "project");
  const stale = await collectStaleIndexTargets(project);
  if (stale.length === 0 || options.dryRun) return { stale, written: [] };
  const written = await writeNavigationIndex(project);
  return { stale, written: written.map((target) => target.path) };
}

export type MaintainRepairInput = {
  repaired: Array<{ taskId: string; completedAt: string; files: string[]; changes: string[] }>;
  alreadyCurrent: number;
  missingDocs: string[];
  archiveCandidates: Array<{ taskId: string; completedAt: string; ageDays: number }>;
};

export async function maintainProject(args: string[], repair?: MaintainRepairInput) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const worktree = args.includes("--worktree");
  const dryRun = args.includes("--dry-run");
  const result = await collectMaintenancePlan(options.project, options.base, options.repo, undefined, undefined, { worktree });
  const indexRefresh = await autoRefreshIndex(options.project, { dryRun });
  appendLogEntry("maintain", options.project, {
    project: options.project,
    details: [worktree ? "mode=worktree" : `base=${options.base}`, `actions=${result.actions.length}`, `index_stale=${indexRefresh.stale.length}`, `index_written=${indexRefresh.written.length}`, ...(repair ? [`repaired=${repair.repaired.length}`] : [])],
  });
  const missingTests = result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length;
  const gateOk = missingTests === 0;
  if (json) {
    const shaped = verbose ? result : compactMaintainForJson(result);
    console.log(JSON.stringify({ ...shaped, ...(repair ? { repair } : {}), indexRefresh, gate: { ok: gateOk, missingTests } }, null, 2));
  } else {
    if (result.focus.activeTask) console.log(`active task: ${result.focus.activeTask.id} ${result.focus.activeTask.title} (plan=${result.focus.activeTask.planStatus} test-plan=${result.focus.activeTask.testPlanStatus})`);
    else if (result.focus.recommendedTask) console.log(`next backlog task: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
    for (const warning of result.focus.warnings) console.log(`- backlog warning: ${warning}`);
    if (repair) {
      console.log(`legacy done-slice repair: repaired=${repair.repaired.length} already_current=${repair.alreadyCurrent} missing_docs=${repair.missingDocs.length}`);
      if (repair.archiveCandidates.length) console.log(`- archive candidates: ${repair.archiveCandidates.map((candidate) => `${candidate.taskId} (${candidate.ageDays}d)`).join(", ")}`);
    }
    console.log(`maintain plan for ${options.project}:`);
    console.log(`- repo: ${result.repo}`);
    console.log(`- base: ${result.base}`);
    console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
    console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
    console.log(`- uncovered files: ${result.discover.uncoveredFiles.length}`);
    console.log(`- repo docs to move: ${result.discover.repoDocFiles.length}`);
    console.log(`- changed tests: ${result.refreshFromGit.testHealth.changedTestFiles.length}`);
    console.log(`- code changes without changed tests: ${missingTests}`);
    console.log(`- lint issues: ${result.lint.issues.length}`);
    console.log(`- semantic issues: ${result.semanticLint.issues.length}`);
    if (indexRefresh.stale.length) {
      console.log(dryRun
        ? `- index refresh: ${indexRefresh.stale.length} stale (dry-run; skipped)`
        : `- index refresh: ${indexRefresh.written.length} file(s) rewritten`);
    } else {
      console.log(`- index refresh: up to date`);
    }
    console.log(`- GATE: ${gateOk ? "PASS" : `FAIL — ${missingTests} code file(s) without tests`}`);
    console.log(`- actions:`);
    if (verbose) {
      for (const action of result.actions) console.log(`  - ${formatMaintenanceActionLabel(action)} ${action.message}`);
    } else {
      for (const line of collapseActions(result.actions)) console.log(`  - ${line}`);
    }
    if (verbose) {
      console.log(`- closeout:`);
      console.log(`  1. run tests`);
      console.log(worktree
        ? `  2. inspect live worktree changes with wiki maintain ${options.project} --repo ${result.repo} --worktree`
        : `  2. wiki refresh-from-git ${options.project} --base ${options.base}`);
      console.log(`  3. wiki drift-check ${options.project} --show-unbound`);
      console.log(`  4. update impacted wiki pages`);
      console.log(`  5. wiki verify-page ${options.project} <page...> <level>`);
      console.log(`  6. wiki lint ${options.project} && wiki lint-semantic ${options.project}`);
      console.log(worktree
        ? `  7. wiki gate ${options.project} --repo ${result.repo} --worktree`
        : `  7. wiki gate ${options.project} --repo ${result.repo} --base ${options.base}`);
    }
  }
}

export function collapseActions(actions: Array<Pick<MaintenanceAction, "kind" | "message" | "scope">>): string[] {
  const buckets = new Map<string, Array<Pick<MaintenanceAction, "kind" | "message" | "scope">>>();
  const order: string[] = [];
  for (const action of actions) {
    const key = `${action.scope ?? ""}::${action.kind}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(action);
  }
  const out: string[] = [];
  for (const key of order) {
    const group = buckets.get(key)!;
    const label = formatMaintenanceActionLabel(group[0]!);
    if (group.length === 1) {
      out.push(`${label} ${group[0].message}`);
    } else {
      out.push(`${label} ${group.length} items (first: ${group[0].message})`);
    }
  }
  return out;
}

export function compactMaintainForJson(result: Awaited<ReturnType<typeof collectMaintenancePlan>>) {
  return {
    ...result,
    refreshFromGit: {
      ...result.refreshFromGit,
      impactedPages: result.refreshFromGit.impactedPages.map(({ diffSummary: _drop, ...row }) => row),
    },
  };
}

export async function collectMaintenancePlan(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.precomputedRefreshFromGit ?? (
    options.worktree
      ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
      : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot)
  );
  const [discover, lint, semanticLint, focus, hierarchyActions, lifecycleDriftActions, cancelledSyncActions] = await Promise.all([
    collectDiscoverSummary(project, explicitRepo, projectSnapshot),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
    collectBacklogFocus(project),
    collectHierarchyStatusActions(project),
    collectLifecycleDriftActions(project),
    collectCancelledSyncActions(project),
  ]);
  const actions: MaintenanceAction[] = [];
  if (focus.activeTask) actions.push({ kind: "active-task", scope: "slice", message: `${focus.activeTask.id} ${focus.activeTask.title} (plan=${focus.activeTask.planStatus}, test-plan=${focus.activeTask.testPlanStatus})` });
  else if (focus.recommendedTask) actions.push({ kind: "next-task", scope: "slice", message: `${focus.recommendedTask.id} ${focus.recommendedTask.title}` });
  for (const warning of focus.warnings) actions.push({ kind: "backlog-warning", scope: "history", message: warning });
  for (const impacted of refreshFromGit.impactedPages) actions.push({ kind: "review-page", scope: "slice", message: `${impacted.page} impacted by ${impacted.matchedSourcePaths.join(", ")}` });
  for (const file of refreshFromGit.uncoveredFiles.slice(0, 20)) actions.push({ kind: "create-or-bind", scope: "slice", message: `cover changed file ${file}` });
  for (const file of refreshFromGit.testHealth.codeFilesWithoutChangedTests.slice(0, 20)) actions.push({ kind: "add-tests", scope: "slice", message: `changed code without changed tests: ${file}` });
  for (const file of discover.repoDocFiles.slice(0, 20)) actions.push({ kind: "move-doc-to-wiki", scope: "project", message: `repo markdown doc should live in wiki: ${file}` });
  for (const page of discover.unboundPages.slice(0, 20)) actions.push({ kind: "bind-page", scope: "project", message: `${page} has no source_paths` });
  for (const issue of lint.issues.slice(0, 20)) actions.push({ kind: "fix-structure", scope: "project", message: issue });
  for (const issue of semanticLint.issues.slice(0, 20)) actions.push({ kind: "fix-semantic", scope: "project", message: issue });
  // Apply cascade-refresh actions (Behavior A, PRD-057): stamp updated: + verified_against:
  // forward for pages whose source_paths all still hash to their verified_against sha.
  // These are async _apply() closures; await each in sequence (idempotence check inside).
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
  // Apply R2/R3 lifecycle drift actions first (they may affect computed_status for R1).
  // R4 escalations (no _apply) surface as operator actions.
  const anyLifecycleApplied = lifecycleDriftActions.some((a) => !!a._apply);
  for (const action of lifecycleDriftActions) {
    if (action._apply) {
      action._apply();
    } else {
      // R4 escalations have no _apply — include in actions for operator visibility
      actions.push({ kind: action.kind, scope: action.scope, message: action.message });
    }
  }
  // Re-collect R1 (hierarchy status) AFTER R2/R3 applied so closures use fresh frontmatter.
  // Only re-collect when R2/R3 actually ran (to avoid a redundant vault walk in the common case).
  const freshHierarchyActions = anyLifecycleApplied ? await collectHierarchyStatusActions(project) : hierarchyActions;
  // Apply R1 (write computed_status); exclude applied from actions
  for (const action of freshHierarchyActions) action._apply?.();
  return { project, repo: refreshFromGit.repo, base: options.worktree ? "WORKTREE" : base, focus, refreshFromGit, discover, lint, semanticLint, actions };
}
