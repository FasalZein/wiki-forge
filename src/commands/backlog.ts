// Re-export facade — see backlog-io.ts, backlog-collect.ts, backlog-commands.ts, slice-scaffold.ts
export type { BacklogItem } from "./backlog-io";
export { moveTaskToSection } from "./backlog-io";
export type { TaskDocState, BacklogTaskContext, BacklogFocus } from "./backlog-collect";
export { collectBacklog, collectBacklogView, collectBacklogFocus, collectTaskContextForId } from "./backlog-collect";
export { backlogCommand, addTask, moveTask, completeTask } from "./backlog-commands";
export { createIssueSlice } from "./slice-scaffold";
