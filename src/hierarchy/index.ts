export { featureStatusCommand, collectFeatureStatuses } from "./feature-status";
export type { FeatureStatusRow, PrdStatusRow } from "./feature-status";
export {
  computeEntityStatus,
  lifecycleOpen,
  lifecycleClose,
  collectLifecycleDriftActions,
  collectHierarchyStatusActions,
} from "./lifecycle";
export { startFeature } from "./start-feature";
export { closeFeature } from "./close-feature";
export { startPrd } from "./start-prd";
export { closePrd } from "./close-prd";

export {
  backlogCommand,
  addTask,
  moveTask,
  completeTask,
  collectBacklog,
  collectTaskContextForId,
  collectBacklogFocus,
  detectTaskDocState,
  moveTaskToSection,
} from "./backlog";
export type { BacklogItem, TaskDocState, BacklogTaskContext, BacklogFocus } from "./backlog";
export { appendTaskToBacklog, parseTaskArgs } from "./backlog-io";
export { createFeature, createPrd, createPlan, createTestPlan, slugify } from "./planning";
export { dependencyGraph } from "./dependency-graph";
export { updateIndex, writeProjectIndex, collectStaleIndexTargets, writeNavigationIndex, writeNamedNavigationTargets } from "./index-log";
export { summaryProject } from "./summary";
export { createLayerPage, lintVault, scaffoldLayer } from "./layers";
