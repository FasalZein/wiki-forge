// Facade: re-exports all public names from the split maintenance modules.
// External callers import from here unchanged.

export { resolveDefaultBase, findProjectArg, parseProjectRepoArgs, parseProjectRepoBaseArgs, gitChangedFiles, gitLines, normalizeRelPath, bindingMatchesFile, worktreeChangedFiles, worktreeModifiedAt, parseEntryUpdated, gitMarkdownStatusFingerprint } from "./git-utils";

export { SCAFFOLD_DIRS, DEFAULT_CODE_PATTERNS, listCodeFiles, listRepoMarkdownDocs, isAllowedRepoMarkdownDoc, buildDirectoryTree, readCodePaths } from "./repo-scan";

export { STRIP_SUFFIXES, STRIP_DOTTED, STRIP_HYPHEN, normalizeBasename, isTestFile, isCodeFile, codeMatchKeys, testMatchKeys, guessModuleName, collectChangedTestHealth } from "./test-health";

export type { DoneSliceRepair } from "./slice-repair";
export { repairHistoricalDoneSlices, readDoneSliceDocs, inferHistoricalCompletedAt, collectDoneSliceRepairChanges, normalizeDoneSliceDoc, classifyArchiveCandidate, isHistoricalDoneSlicePage } from "./slice-repair";

export type { ProjectSnapshot, RefreshOptions, WorktreeImpactedPage } from "./snapshot";
export { loadProjectSnapshot, collectRefreshFromGit, collectRefreshFromWorktree, projectSnapshotToLintingSnapshot, collectCloseout, collectMaintenancePlan, collectDiscoverSummary, collectDashboard } from "./snapshot";

export { dashboardProject, maintainProject, closeoutProject, refreshProject, refreshFromGit, discoverProject, ingestDiff, collectIngestDiff, compactCloseoutForJson, renderCloseout } from "./maintenance-commands";
