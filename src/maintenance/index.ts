export type { ProjectSnapshot, RefreshOptions, WorktreeImpactedPage } from "./_shared";
export {
  loadProjectSnapshot,
  collectRefreshFromGit,
  collectRefreshFromWorktree,
  projectSnapshotToLintingSnapshot,
} from "./_shared";

export { maintainProject, collectMaintenancePlan, collapseActions, compactMaintainForJson, autoRefreshIndex } from "./maintain";
export { closeoutProject, collectCloseout, compactCloseoutForJson, renderCloseout } from "./closeout";
export { refreshProject, refreshFromGit, refreshOnMerge } from "./refresh";
export { discoverProject, collectDiscoverSummary, dashboardProject, collectDashboard, collectIngestDiff, ingestDiff } from "./discover";
export { checkpoint, collectCheckpoint } from "./checkpoint";
export { commitCheck, collectCommitCheck, installGitHook } from "./commit-check";
export { doctorProject, collectDoctor, compactDoctorForJson } from "./doctor";
export { gateProject, collectGate } from "./gate";
export { lintRepo } from "./lint-repo";
export { driftCheck, collectDriftSummary } from "./drift";
export {
  STRIP_SUFFIXES,
  STRIP_DOTTED,
  STRIP_HYPHEN,
  normalizeBasename,
  isTestFile,
  isCodeFile,
  codeMatchKeys,
  testMatchKeys,
  guessModuleName,
  collectChangedTestHealth,
} from "./test-health";
