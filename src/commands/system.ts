export { scaffoldProject, onboardProject, onboardPlan, createModule, normalizeModule } from "./project-setup";
export { backlogCommand, addTask, moveTask, completeTask, createIssueSlice } from "./backlog";
export { createPrd, createPlan, createTestPlan } from "./planning";
export { dashboardProject, maintainProject, refreshProject, refreshFromGit, discoverProject, ingestDiff } from "./maintenance";
export { updateIndex, logCommand } from "./index-log";
export { statusProject, lintProject, lintSemanticProject, verifyProject, cacheClear } from "./linting";
export { printHelp } from "../cli-shared";
