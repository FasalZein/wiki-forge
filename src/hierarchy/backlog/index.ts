// Re-export facade — see io.ts, collect.ts, commands.ts
export type { BacklogItem } from "./io";
export { rewriteBacklogRowMarker } from "./io";
export type { TaskDocState, BacklogTaskContext, BacklogFocus } from "./collect";
export { collectBacklog, collectBacklogView, collectBacklogFocus, collectTaskContextForId, detectTaskDocState } from "./collect";
