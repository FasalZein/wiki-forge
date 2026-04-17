import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { projectRoot, assertExists, safeMatter } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { gitDiffSummary, readVerificationLevel, resolveRepoPath, assertGitRepo } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { collectBacklogFocus } from "./backlog";
import { collectDriftSummary } from "./verification";
import { collectHierarchyStatusActions, collectLifecycleDriftActions } from "./hierarchy-commands";
import { collectLintResult, collectSemanticLintResult, collectStatusRow, collectVerifySummary, loadLintingSnapshot } from "./linting";
import type { LintingSnapshot } from "./linting";
import { gitChangedFiles, bindingMatchesFile, gitLastShaForPath, worktreeChangedFiles, worktreeModifiedAt, parseEntryUpdated } from "./git-utils";
import { listCodeFiles, listRepoMarkdownDocs, readCodePaths } from "./repo-scan";
import { collectChangedTestHealth, isCodeFile } from "./test-health";
import { isHistoricalDoneSlicePage } from "./slice-repair";
import { tailLog } from "../lib/log";
import { classifyProjectDocPath } from "../lib/structure";

function sliceTaskIdFromPage(page: string) {
  const match = page.match(/^specs\/slices\/([^/]+)\//u);
  return match?.[1] ?? null;
}

function suppressionReasonForWorktreePlanningPage(
  entry: ProjectSnapshot["pageEntries"][number],
  scope: { activeTaskId: string | null; actionableSliceIds: Set<string>; activePrd: string | null; activeFeature: string | null },
): WorktreeImpactedPage["suppressionReason"] | null {
  if (isHistoricalDoneSlicePage(entry)) return "historical-done-slice";
  const sliceTaskId = sliceTaskIdFromPage(entry.page);
  if (sliceTaskId !== null) return scope.actionableSliceIds.has(sliceTaskId) ? null : "non-actionable-planning";
  if (!scope.activeTaskId) return null;
  if (entry.page === "_summary.md" || entry.page === "learnings.md" || entry.page === "decisions.md" || entry.page.startsWith("legacy/")) return "non-actionable-planning";
  if (entry.page.startsWith("specs/prds/")) return entry.parsed?.data.prd_id === scope.activePrd ? null : "non-actionable-planning";
  if (entry.page.startsWith("specs/features/")) return entry.parsed?.data.feature_id === scope.activeFeature ? null : "non-actionable-planning";
  return null;
}

export type ProjectSnapshot = {
  project: string;
  root: string;
  repo: string;
  pages: string[];
  repoFiles?: string[];
  repoDocFiles?: string[];
  pageEntries: Array<{
    file: string;
    page: string;
    relPath: string;
    vaultPath: string;
    raw: string;
    parsed: ReturnType<typeof safeMatter>;
    sourcePaths: string[];
    rawUpdated: unknown;
    verificationLevel: ReturnType<typeof readVerificationLevel>;
    verifiedAgainst: string | null;
    todoCount: number;
  }>;
};

export type RefreshOptions = {
  worktree?: boolean;
  precomputedRefreshFromGit?: Awaited<ReturnType<typeof collectRefreshFromGit>> | Awaited<ReturnType<typeof collectRefreshFromWorktree>>;
};

export type WorktreeImpactedPage = {
  page: string;
  matchedSourcePaths: string[];
  verificationLevel: string | null;
  diffSummary: string[];
  stale: boolean;
  pageUpdated: string;
  lastSourceChange: string;
  suppressionReason?: "historical-done-slice" | "non-actionable-planning";
};

export async function loadProjectSnapshot(project: string, explicitRepo?: string, options: { includeRepoInventory?: boolean } = {}): Promise<ProjectSnapshot> {
  const root = projectRoot(project);
  await assertExists(root, `project not found: ${project}`);
  const repo = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repo);
  const pages = await walkMarkdown(root);
  const pageEntries = await Promise.all(pages.map(async (file) => {
    const raw = await readText(file);
    const relPath = relative(root, file).replaceAll("\\", "/");
    const vaultPath = relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/");
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    const sourcePaths = parsed && Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value: unknown) => String(value).replaceAll("\\", "/")) : [];
    return {
      file,
      page: relPath,
      relPath,
      vaultPath,
      raw,
      parsed,
      sourcePaths,
      rawUpdated: parsed?.data.updated,
      verificationLevel: parsed ? readVerificationLevel(parsed.data) : null,
      verifiedAgainst: parsed && typeof parsed.data.verified_against === "string" ? parsed.data.verified_against : null,
      todoCount: (raw.match(/\bTODO\b/g) ?? []).length,
    };
  }));
  if (!options.includeRepoInventory) return { project, root, repo, pages, pageEntries };
  return {
    project,
    root,
    repo,
    pages,
    repoFiles: listCodeFiles(repo, await readCodePaths(project)),
    repoDocFiles: await listRepoMarkdownDocs(repo),
    pageEntries,
  };
}

export async function collectRefreshFromGit(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo);
  const changedFiles = await gitChangedFiles(state.repo, base);
  const changedFileSet = new Set(changedFiles);
  const diffSummaryCache = new Map<string, string[]>();
  const impactedPages: Array<{ page: string; matchedSourcePaths: string[]; verificationLevel: string | null; diffSummary: string[] }> = [];
  const covered = new Set<string>();
  const lastShaCache = new Map<string, string | null>();
  const acknowledgedPages: string[] = [];
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const matchedSourcePaths = entry.sourcePaths.filter((sourcePath) => changedFileSet.has(sourcePath));
    if (!matchedSourcePaths.length) continue;
    for (const sourcePath of matchedSourcePaths) covered.add(sourcePath);
    // WIKI-FORGE-104: if verified_against equals the latest commit sha that
    // touched any of the matched source paths, skip re-listing this page.
    if (entry.verifiedAgainst) {
      let stillAcknowledged = true;
      for (const sourcePath of matchedSourcePaths) {
        if (!lastShaCache.has(sourcePath)) lastShaCache.set(sourcePath, await gitLastShaForPath(state.repo, sourcePath));
        if (lastShaCache.get(sourcePath) !== entry.verifiedAgainst) { stillAcknowledged = false; break; }
      }
      if (stillAcknowledged) {
        acknowledgedPages.push(entry.page);
        continue;
      }
    }
    const diffSummary: string[] = [];
    for (const sourcePath of matchedSourcePaths) {
      if (!diffSummaryCache.has(sourcePath)) diffSummaryCache.set(sourcePath, await gitDiffSummary(state.repo, sourcePath) ?? []);
      diffSummary.push(...(diffSummaryCache.get(sourcePath) ?? []));
    }
    impactedPages.push({ page: entry.page, matchedSourcePaths, verificationLevel: entry.verificationLevel, diffSummary });
  }
  const testHealth = collectChangedTestHealth(changedFiles);
  return { project, repo: state.repo, base, changedFiles, impactedPages, acknowledgedPages, uncoveredFiles: changedFiles.filter((file) => isCodeFile(file) && !covered.has(file)), testHealth };
}

export async function collectRefreshFromWorktree(project: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo);
  const changedFiles = await worktreeChangedFiles(state.repo);
  const changedFileSet = new Set(changedFiles);
  const focus = await collectBacklogFocus(project);
  const activeTaskId = focus.activeTask?.id ?? null;
  const actionableSliceIds = new Set(focus.inProgress.map((task) => task.id));
  const activeSliceEntry = activeTaskId
    ? state.pageEntries.find((entry) => entry.page === `specs/slices/${activeTaskId}/index.md`)
    : null;
  const activePrd = typeof activeSliceEntry?.parsed?.data.parent_prd === "string" ? activeSliceEntry.parsed.data.parent_prd : null;
  const activeFeature = typeof activeSliceEntry?.parsed?.data.parent_feature === "string" ? activeSliceEntry.parsed.data.parent_feature : null;
  const impactedPages: WorktreeImpactedPage[] = [];
  const suppressedPages: WorktreeImpactedPage[] = [];
  const coveredByActionable = new Set<string>();
  const coveredByHistoricalSuppressed = new Set<string>();
  const coveredByNonActionablePlanning = new Set<string>();
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const matchedSourcePaths = entry.sourcePaths.filter((sourcePath) => [...changedFileSet].some((file) => bindingMatchesFile(sourcePath, file)));
    if (!matchedSourcePaths.length) continue;
    const matchedFiles = changedFiles.filter((candidate) => matchedSourcePaths.some((sourcePath) => bindingMatchesFile(sourcePath, candidate)));
    const suppressionReason = suppressionReasonForWorktreePlanningPage(entry, { activeTaskId, actionableSliceIds, activePrd, activeFeature });
    for (const file of matchedFiles) {
      if (!suppressionReason) coveredByActionable.add(file);
      else if (suppressionReason === "historical-done-slice") coveredByHistoricalSuppressed.add(file);
      else coveredByNonActionablePlanning.add(file);
    }
    const pageUpdated = parseEntryUpdated(entry.rawUpdated);
    const lastModified = matchedFiles
      .map((file) => worktreeModifiedAt(state.repo, file))
      .filter((value): value is number => Number.isFinite(value))
      .sort((a, b) => b - a)[0];
    const stale = pageUpdated === null || (typeof lastModified === "number" && lastModified > pageUpdated.getTime());
    const pageData: WorktreeImpactedPage = {
      page: entry.page,
      matchedSourcePaths,
      verificationLevel: entry.verificationLevel,
      diffSummary: matchedFiles.map((file) => `worktree: ${file}`),
      stale,
      pageUpdated: String(entry.rawUpdated ?? "missing"),
      lastSourceChange: typeof lastModified === "number" ? new Date(lastModified).toISOString() : "unknown",
      ...(suppressionReason ? { suppressionReason } : {}),
    };
    (suppressionReason ? suppressedPages : impactedPages).push(pageData);
  }
  const outsideActiveHierarchyFiles = changedFiles.filter((file) => isCodeFile(file) && !coveredByActionable.has(file) && coveredByNonActionablePlanning.has(file));
  const testHealth = collectChangedTestHealth(changedFiles);
  return {
    project,
    repo: state.repo,
    base: "WORKTREE",
    changedFiles,
    impactedPages,
    suppressedPages,
    outsideActiveHierarchyFiles,
    uncoveredFiles: changedFiles.filter((file) => isCodeFile(file) && !coveredByActionable.has(file) && !coveredByNonActionablePlanning.has(file)),
    testHealth,
  };
}

export function projectSnapshotToLintingSnapshot(snapshot: ProjectSnapshot, noteIndex?: LintingSnapshot["noteIndex"]): LintingSnapshot {
  return {
    project: snapshot.project,
    root: snapshot.root,
    pages: snapshot.pages,
    noteIndex,
    pageEntries: snapshot.pageEntries.map((entry) => ({
      file: entry.file,
      relPath: entry.relPath,
      vaultPath: entry.vaultPath,
      raw: entry.raw,
      parsed: entry.parsed,
      sourcePaths: entry.sourcePaths,
      rawUpdated: entry.rawUpdated,
      verificationLevel: entry.verificationLevel,
    })),
  };
}

export async function collectCloseout(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.worktree
    ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
    : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot);
  // Run independent checks in parallel — drift, lint, and semantic lint
  // share no mutable state and depend only on the already-loaded snapshots.
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

export async function collectMaintenancePlan(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.precomputedRefreshFromGit ?? (
    options.worktree
      ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
      : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot)
  );
  // Run independent checks in parallel — discover, lint, semantic lint, backlog focus,
  // hierarchy status, and lifecycle drift all share no mutable state and depend only on already-loaded snapshots.
  const [discover, lint, semanticLint, focus, hierarchyActions, lifecycleDriftActions] = await Promise.all([
    collectDiscoverSummary(project, explicitRepo, projectSnapshot),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
    collectBacklogFocus(project),
    collectHierarchyStatusActions(project),
    collectLifecycleDriftActions(project),
  ]);
  const actions: Array<{ kind: string; message: string }> = [];
  if (focus.activeTask) actions.push({ kind: "active-task", message: `${focus.activeTask.id} ${focus.activeTask.title} (plan=${focus.activeTask.planStatus}, test-plan=${focus.activeTask.testPlanStatus})` });
  else if (focus.recommendedTask) actions.push({ kind: "next-task", message: `${focus.recommendedTask.id} ${focus.recommendedTask.title}` });
  for (const warning of focus.warnings) actions.push({ kind: "backlog-warning", message: warning });
  for (const impacted of refreshFromGit.impactedPages) actions.push({ kind: "review-page", message: `${impacted.page} impacted by ${impacted.matchedSourcePaths.join(", ")}` });
  for (const file of refreshFromGit.uncoveredFiles.slice(0, 20)) actions.push({ kind: "create-or-bind", message: `cover changed file ${file}` });
  for (const file of refreshFromGit.testHealth.codeFilesWithoutChangedTests.slice(0, 20)) actions.push({ kind: "add-tests", message: `changed code without changed tests: ${file}` });
  for (const file of discover.repoDocFiles.slice(0, 20)) actions.push({ kind: "move-doc-to-wiki", message: `repo markdown doc should live in wiki: ${file}` });
  for (const page of discover.unboundPages.slice(0, 20)) actions.push({ kind: "bind-page", message: `${page} has no source_paths` });
  for (const issue of lint.issues.slice(0, 20)) actions.push({ kind: "fix-structure", message: issue });
  for (const issue of semanticLint.issues.slice(0, 20)) actions.push({ kind: "fix-semantic", message: issue });
  for (const action of hierarchyActions) actions.push({ kind: action.kind, message: action.message });
  for (const action of lifecycleDriftActions) actions.push({ kind: action.kind, message: action.message });
  // Apply computed_status writes immediately so pages reflect fresh hierarchy state
  for (const action of hierarchyActions) action._apply?.();
  return { project, repo: refreshFromGit.repo, base: options.worktree ? "WORKTREE" : base, focus, refreshFromGit, discover, lint, semanticLint, actions };
}

export async function collectDiscoverSummary(project: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const boundFiles = new Set<string>();
  const unboundPages: string[] = [];
  const placeholderHeavyPages: string[] = [];
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const kind = classifyProjectDocPath(entry.relPath);
    if (!entry.sourcePaths.length && kind !== "session-handover") unboundPages.push(entry.page);
    for (const sourcePath of entry.sourcePaths) boundFiles.add(sourcePath);
    if (entry.todoCount >= 6) placeholderHeavyPages.push(entry.page);
  }
  // Detect research/docs directories in the repo
  const researchDirs: string[] = [];
  for (const candidate of ["docs/research", "docs", "research", "docs/specs"]) {
    const candidatePath = join(state.repo, candidate);
    if (await exists(candidatePath)) {
      try {
        const count = [...new Bun.Glob("**/*.md").scanSync({ cwd: candidatePath, onlyFiles: true })].length;
        if (count > 0) researchDirs.push(`${candidate}/ (${count} docs)`);
      } catch {}
    }
  }
  const repoFiles = state.repoFiles ?? listCodeFiles(state.repo, await readCodePaths(project));
  const repoDocFiles = state.repoDocFiles ?? await listRepoMarkdownDocs(state.repo);
  return { project, repo: state.repo, repoFiles: repoFiles.length, boundFiles: boundFiles.size, uncoveredFiles: repoFiles.filter((file) => !boundFiles.has(file)), unboundPages: unboundPages.sort(), placeholderHeavyPages: placeholderHeavyPages.sort(), researchDirs, repoDocFiles };
}


export async function collectDashboard(project: string, base: string, explicitRepo?: string) {
  const [projectSnapshot, lintingSnapshot] = await Promise.all([
    loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true }),
    loadLintingSnapshot(project, { noteIndex: true }),
  ]);
  const maintain = await collectMaintenancePlan(project, base, explicitRepo, projectSnapshot, lintingSnapshot);
  const [status, verify, drift] = await Promise.all([
    collectStatusRow(project, lintingSnapshot),
    collectVerifySummary(project, lintingSnapshot),
    collectDriftSummary(project, explicitRepo, lintingSnapshot),
  ]);
  return { project, repo: maintain.repo, base, status, verify, drift, discover: maintain.discover, maintain, recentLog: await tailLog(20) };
}
