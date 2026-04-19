import { type PipelineProgressEntry } from "../lib/slice-progress";
import type { ForgeSteeringPacket } from "../lib/forge-steering";

export type AutoCloseAttempt =
  | { sliceId: string; attempted: true; closed: true }
  | { sliceId: string; attempted: true; closed: false; reason: string }
  | null;

export type HandoverPromptContext = {
  project: string;
  repo: string;
  base: string;
  focus: { activeTask: { id: string; title: string } | null; recommendedTask: { id: string; title: string } | null; warnings: string[] };
  steering: ForgeSteeringPacket | null;
  dirty: { modifiedFiles: string[]; untrackedFiles: string[]; stagedFiles: string[] };
  actions: Array<{ kind: string; message: string }>;
  sessionActivity: { totalCommands: number; commandCounts: Record<string, number> };
  recentNotes: string[];
  recentCommits: string[];
  commitsSinceBase: string[];
  pipelineProgress: PipelineProgressEntry[] | null;
  autoCloseAttempt: AutoCloseAttempt;
};

function summarizeDirtyState(dirty: HandoverPromptContext["dirty"]): string {
  const parts = [
    `modified=${dirty.modifiedFiles.length}`,
    `staged=${dirty.stagedFiles.length}`,
    `untracked=${dirty.untrackedFiles.length}`,
  ];
  return parts.every((part) => part.endsWith("=0")) ? "clean working tree" : parts.join(", ");
}

export function buildNextSessionPrompt(result: HandoverPromptContext): string {
  const lines: string[] = [];
  lines.push(`Continue work on ${result.project}. Repo: ${result.repo}`);
  lines.push(`Start with: wiki resume ${result.project} --repo ${result.repo} --base ${result.base}`);
  lines.push("");
  if (result.dirty.modifiedFiles.length || result.dirty.untrackedFiles.length) {
    lines.push(`Warning: ${result.dirty.modifiedFiles.length} modified, ${result.dirty.untrackedFiles.length} untracked files — review and commit or discard before starting new work.`);
  }
  if (result.autoCloseAttempt?.attempted) {
    if (result.autoCloseAttempt.closed) {
      lines.push(`Previous session auto-closed ${result.autoCloseAttempt.sliceId}`);
    } else {
      lines.push(`Auto-close attempted but failed: ${result.autoCloseAttempt.reason}`);
    }
  }
  if (result.focus.activeTask) {
    lines.push(`Active slice: ${result.focus.activeTask.id} — ${result.focus.activeTask.title}. Continue this first.`);
  } else if (result.focus.recommendedTask) {
    const nextCommand = result.steering?.nextCommand ?? `wiki forge run ${result.project} ${result.focus.recommendedTask.id} --repo ${result.repo}`;
    lines.push(`Next slice: ${result.focus.recommendedTask.id} — ${result.focus.recommendedTask.title}. Start with: ${nextCommand}`);
  }
  const priorityActions = result.actions.filter((action) => !action.kind.startsWith("move-doc")).slice(0, 3);
  if (priorityActions.length) {
    lines.push("");
    lines.push("Priorities:");
    for (const action of priorityActions) lines.push(`- [${action.kind}] ${action.message}`);
  }
  if (result.recentNotes.length) {
    lines.push("");
    lines.push(`Previous agent note: ${result.recentNotes[0]}`);
  }
  if (result.commitsSinceBase.length) {
    lines.push("");
    lines.push("Session commits:");
    for (const commit of result.commitsSinceBase.slice(0, 10)) lines.push(`- ${commit}`);
  }
  if (result.pipelineProgress) {
    lines.push("");
    lines.push("Last pipeline run:");
    for (const step of result.pipelineProgress) {
      const status = step.ok ? "ok" : "fail";
      const duration = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : "";
      const err = step.error ? ` — ${step.error}` : "";
      lines.push(`- ${step.step}: ${status}${duration}${err}`);
    }
  }
  return lines.join("\n");
}

export function buildShortPrompt(result: HandoverPromptContext): string {
  const lines: string[] = [];
  lines.push(`Continue ${result.project} on repo ${result.repo}.`);
  lines.push("");
  lines.push("Load /wiki and /forge.");
  lines.push("Run:");
  lines.push(`  wiki resume ${result.project} --repo ${result.repo} --base ${result.base}`);
  const focusId = result.focus.activeTask?.id ?? result.focus.recommendedTask?.id ?? null;
  if (focusId) {
    lines.push("");
    lines.push(result.focus.activeTask ? "Then continue the active slice:" : "Then continue the tracked backlog, starting with:");
    lines.push(`  ${result.steering?.nextCommand ?? `wiki forge run ${result.project} ${focusId} --repo ${result.repo} --base ${result.base}`}`);
    if (result.steering?.loadSkill) lines.push(`  load ${result.steering.loadSkill}`);
  }

  const contextLines = [
    "- /wiki is still the second-brain layer",
    "- /forge is still the SDLC layer",
    `- dirty state: ${summarizeDirtyState(result.dirty)}`,
  ];
  if (result.recentCommits.length) {
    contextLines.push(`- latest commits: ${result.recentCommits.slice(0, 3).join(", ")}`);
  }
  if (result.autoCloseAttempt?.attempted) {
    contextLines.push(
      result.autoCloseAttempt.closed
        ? `- last auto-close: ${result.autoCloseAttempt.sliceId} closed cleanly`
        : `- last auto-close failed: ${result.autoCloseAttempt.reason}`,
    );
  }
  if (result.focus.warnings.length) {
    contextLines.push(`- workflow warnings: ${result.focus.warnings.slice(0, 2).join("; ")}`);
  }
  if (contextLines.length) {
    lines.push("");
    lines.push("Context:");
    lines.push(...contextLines);
  }
  return lines.join("\n");
}

export function buildAccomplishments(result: HandoverPromptContext): string[] {
  const items: string[] = [];
  if (result.autoCloseAttempt?.attempted && result.autoCloseAttempt.closed) {
    items.push(`Auto-closed ${result.autoCloseAttempt.sliceId} because the slice was already test-verified.`);
  }
  if (result.commitsSinceBase.length) {
    items.push(`Session commits since ${result.base}: ${result.commitsSinceBase.slice(0, 5).join(", ")}.`);
  } else if (result.recentCommits.length) {
    items.push(`Recent repo commits at handover: ${result.recentCommits.slice(0, 3).join(", ")}.`);
  }
  if (result.sessionActivity.totalCommands > 0) {
    const breakdown = Object.entries(result.sessionActivity.commandCounts)
      .slice(0, 6)
      .map(([command, count]) => `${command}=${count}`)
      .join(", ");
    items.push(`Recorded ${result.sessionActivity.totalCommands} command(s) this session${breakdown ? ` (${breakdown})` : ""}.`);
  }
  if (result.recentNotes.length) {
    items.push(`Latest agent note: ${result.recentNotes[0]}.`);
  } else if (result.actions.length) {
    items.push(`Captured ${result.actions.length} follow-up action(s) for the next session.`);
  }
  return items.length ? items : ["No durable repo changes or workflow events were recorded during this session."];
}

export function buildBlockers(result: HandoverPromptContext): string[] {
  const items: string[] = [];
  if (result.autoCloseAttempt?.attempted && !result.autoCloseAttempt.closed) {
    items.push(`Auto-close failed for ${result.autoCloseAttempt.sliceId}: ${result.autoCloseAttempt.reason}.`);
  }
  if (result.dirty.modifiedFiles.length || result.dirty.stagedFiles.length || result.dirty.untrackedFiles.length) {
    items.push(`Repo is not clean (${summarizeDirtyState(result.dirty)}).`);
  }
  for (const warning of result.focus.warnings.slice(0, 3)) {
    items.push(warning);
  }
  const blockerActions = result.actions
    .filter((action) => action.kind !== "next-task" && !action.kind.startsWith("move-doc"))
    .slice(0, 3);
  for (const action of blockerActions) {
    items.push(`[${action.kind}] ${action.message}`);
  }
  return items.length ? items : ["No blockers were detected from the current session state."];
}
