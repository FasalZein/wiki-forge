import { join, relative } from "node:path"; // desloppify:ignore *
import { statSync } from "node:fs";
import { VAULT_ROOT } from "../../constants";
import { projectRoot, assertExists, safeMatter } from "../../cli-shared";
import { readText } from "../../lib/fs";
import { readVerificationLevel, resolveRepoPath, assertGitRepo, gitDiffSummary, parseUpdatedDate } from "../../lib/verification";
import { walkMarkdown } from "../../lib/vault";
import { collectBacklogFocus } from "../../hierarchy";
import { gitChangedFiles, bindingMatchesFile, gitLastShaForPath, worktreeChangedFiles, worktreeModifiedAt, parseEntryUpdated } from "../../git-utils";
import { listCodeFiles, listRepoMarkdownDocs, readCodePaths } from "../../protocol/discovery/index";
import { collectChangedTestHealth, isCodeFile } from "../health";
import type { LintingSnapshot } from "../../verification";
import type { MaintenanceAction } from "./diagnostics";
import { createCascadeRefreshAction, filesChangedSinceVerification, verifiedCommitExists } from "./cascade-refresh";
import { isHistoricalDoneSlicePage } from "../../slice/docs";

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
  if (sliceTaskId !== null) {
    if (scope.actionableSliceIds.has(sliceTaskId)) return null;
    return "non-actionable-planning";
  }
  if (!scope.activeTaskId) return null;
  if (entry.page === "_summary.md" || entry.page === "learnings.md" || entry.page === "decisions.md" || entry.page.startsWith("legacy/")) return "non-actionable-planning";
  if (entry.page.startsWith("specs/prds/")) {
    if (entry.parsed?.data.prd_id === scope.activePrd) return null;
    return "non-actionable-planning";
  }
  if (entry.page.startsWith("specs/features/")) {
    if (entry.parsed?.data.feature_id === scope.activeFeature) return null;
    return "non-actionable-planning";
  }
  return null;
}

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

export async function collectRefreshFromGit(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, vaultRoot?: string) {
  const effectiveVaultRoot = vaultRoot ?? VAULT_ROOT;
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo);
  const changedFiles = await gitChangedFiles(state.repo, base);
  const changedFileSet = new Set(changedFiles);
  const diffSummaryCache = new Map<string, string[]>();
  const impactedPages: Array<{ page: string; matchedSourcePaths: string[]; verificationLevel: string | null; diffSummary: string[] }> = [];
  const covered = new Set<string>();
  const lastShaCache = new Map<string, string | null>();
  const acknowledgedPages: string[] = [];
  const cascadeRefreshActions: MaintenanceAction[] = [];
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const matchedSourcePaths = entry.sourcePaths.filter((sourcePath) => changedFileSet.has(sourcePath));
    if (!matchedSourcePaths.length) continue;
    for (const sourcePath of matchedSourcePaths) covered.add(sourcePath);
    if (entry.verifiedAgainst) {
      let stillAcknowledged = true;
      for (const sourcePath of matchedSourcePaths) {
        if (!lastShaCache.has(sourcePath)) lastShaCache.set(sourcePath, await gitLastShaForPath(state.repo, sourcePath));
        if (lastShaCache.get(sourcePath) !== entry.verifiedAgainst) { stillAcknowledged = false; break; }
      }
      if (stillAcknowledged) {
        acknowledgedPages.push(entry.page);
        cascadeRefreshActions.push(
          createCascadeRefreshAction(
            project,
            effectiveVaultRoot,
            {
              file: entry.file,
              page: entry.page,
              content: entry.parsed.content,
              data: entry.parsed.data,
              verifiedAgainst: entry.verifiedAgainst,
            },
            matchedSourcePaths,
          ),
        );
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
  if (changedFiles.length === 0) {
    for (const entry of state.pageEntries) {
      if (!entry.parsed || !entry.verifiedAgainst || entry.sourcePaths.length === 0) continue;
      const pageUpdated = parseEntryUpdated(entry.rawUpdated);
      if (!pageUpdated) continue;
      const driftedSourcePaths = entry.sourcePaths.filter((sourcePath) => {
        const modifiedAt = worktreeModifiedAt(state.repo, sourcePath);
        return Number.isFinite(modifiedAt) && modifiedAt > pageUpdated.getTime();
      });
      if (driftedSourcePaths.length === 0) continue;

      if (!await verifiedCommitExists(state.repo, entry.verifiedAgainst)) continue;
      const sourceFilesChangedSinceVerification = await filesChangedSinceVerification(state.repo, entry.verifiedAgainst, entry.sourcePaths);
      if (sourceFilesChangedSinceVerification.length > 0) continue;

      cascadeRefreshActions.push(
        createCascadeRefreshAction(
          project,
          effectiveVaultRoot,
          {
            file: entry.file,
            page: entry.page,
            content: entry.parsed.content,
            data: entry.parsed.data,
            verifiedAgainst: entry.verifiedAgainst,
          },
          driftedSourcePaths,
          "mtime-drift",
        ),
      );
    }
  }
  const testHealth = collectChangedTestHealth(changedFiles);
  return { project, repo: state.repo, base, changedFiles, impactedPages, acknowledgedPages, cascadeRefreshActions, uncoveredFiles: changedFiles.filter((file) => isCodeFile(file) && !covered.has(file)), testHealth };
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

export function isWorktreeSourceNewer(repo: string, sourcePath: string, updated: Date | null) {
  if (!updated) return true;
  const absolutePath = join(repo, sourcePath);
  try {
    return statSync(absolutePath).mtimeMs > updated.getTime();
  } catch {
    return true;
  }
}
