// Re-export facade — see io.ts, collect.ts, commands.ts
export type { BacklogItem } from "./io";
export { moveTaskToSection, rewriteBacklogRowMarker } from "./io";
export type { TaskDocState, BacklogTaskContext, BacklogFocus } from "./collect";
export { collectBacklog, collectBacklogView, collectBacklogFocus, collectTaskContextForId, detectTaskDocState } from "./collect";
export { backlogCommand, addTask, moveTask, completeTask } from "./commands";
