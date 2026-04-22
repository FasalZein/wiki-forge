export { featureStatusCommand } from "./feature-status";
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
  collectBacklogView,
  collectTaskContextForId,
  collectBacklogFocus,
  detectTaskDocState,
  moveTaskToSection,
  rewriteBacklogRowMarker,
} from "./backlog";
export type { BacklogTaskContext, BacklogFocus } from "./backlog";
export { appendTaskToBacklog, parseTaskArgs } from "./backlog-io";
export { collectCancelledSyncActions } from "./lifecycle-drift";
export { createFeature, createPrd, createPlan, createTestPlan, createFeatureReturningId, createPrdReturningId, slugify } from "./planning";
export { dependencyGraph } from "./dependency-graph";
export { updateIndex, writeProjectIndex, collectStaleIndexTargets, writeNavigationIndex, writeNamedNavigationTargets } from "./index-log";
export { summaryProject } from "./summary";
export { createLayerPage, lintVault, scaffoldLayer } from "./layers";
