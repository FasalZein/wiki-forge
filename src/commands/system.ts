export { scaffoldProject, onboardProject, onboardPlan, createModule, normalizeModule } from "./project-setup";
export { backlogCommand, addTask, moveTask, completeTask, createIssueSlice } from "./backlog";
export { createFeature, createPrd, createPlan, createTestPlan } from "./planning";
export { dashboardProject, maintainProject, refreshProject, refreshFromGit, discoverProject, ingestDiff } from "./maintenance";
export { handoverProject, claimSlice, noteProject, nextProject, verifySlice, closeSlice } from "./coordination";
export { updateIndex, logCommand } from "./index-log";
export { statusProject, lintProject, lintSemanticProject, verifyProject, cacheClear } from "./linting";
export { scaffoldResearch, researchStatus, ingestResearch, ingestSource, lintResearch } from "./research";
export { printHelp } from "../cli-shared";
