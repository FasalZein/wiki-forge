import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { parseProjectRepoBaseArgs } from "../git-utils";
import { collectSessionActivity, resolveSessionId } from "../lib/tracker";
import { collectBacklog } from "../hierarchy";
import { collectMaintenancePlan } from "../maintenance";
import { closeSlice } from "../slice/close";
import { readSliceTestPlan } from "../lib/slices";
import { readVerificationLevel } from "../lib/verification";
import { readSlicePipelineProgress, type PipelineProgressEntry } from "../lib/slice-progress";
import {
  collectDirtyRepoStatus,
  collectRecentCommits,
  collectCommitsSinceBase,
  compactLogEntry,
  projectLogEntries,
  renderSessionActivity,
  writeHandoverFile,
} from "./_shared";

type AutoCloseAttempt =
  | { sliceId: string; attempted: true; closed: true }
  | { sliceId: string; attempted: true; closed: false; reason: string }
  | null;

function buildNextSessionPrompt(result: {
  project: string;
  repo: string;
  base: string;
  focus: { activeTask: { id: string; title: string } | null; recommendedTask: { id: string; title: string } | null; warnings: string[] };
  dirty: { modifiedFiles: string[]; untrackedFiles: string[]; stagedFiles: string[] };
  actions: Array<{ kind: string; message: string }>;
  recentNotes: string[];
  recentCommits: string[];
  commitsSinceBase: string[];
  pipelineProgress: PipelineProgressEntry[] | null;
  autoCloseAttempt: AutoCloseAttempt;
}): string {
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
    lines.push(`Next slice: ${result.focus.recommendedTask.id} — ${result.focus.recommendedTask.title}. Start with: wiki forge run ${result.project} ${result.focus.recommendedTask.id} --repo ${result.repo}`);
  }
  const priorityActions = result.actions.filter((a) => !a.kind.startsWith("move-doc")).slice(0, 3);
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

export async function handoverProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const noWrite = args.includes("--no-write");
  const harnessIndex = args.indexOf("--harness");
  const harness = harnessIndex >= 0 ? args[harnessIndex + 1] : undefined;
  let [maintain, backlog, sessionActivity] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, options.repo),
    collectBacklog(options.project),
    collectSessionActivity(options.project, resolveSessionId()),
  ]);

  // Auto-close the active slice if it is already test-verified
  let autoCloseAttempt: AutoCloseAttempt = null;
  const activeTask = maintain.focus.activeTask;
  if (activeTask) {
    let testPlanLevel: string | null = null;
    try {
      const testPlan = await readSliceTestPlan(options.project, activeTask.id);
      testPlanLevel = readVerificationLevel(testPlan.data);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`handover: could not read test-plan for ${activeTask.id}: ${reason}\n`);
    }
    if (testPlanLevel === "test-verified") {
      const closeArgs = [
        options.project,
        activeTask.id,
        "--repo", maintain.repo,
        "--base", options.base,
        "--slice-local",
      ];
      // Suppress closeSlice's own stdout so it doesn't corrupt --json output.
      // Hook both console.log and process.stdout.write — closeSlice uses the
      // former today, but anything it delegates to could use the latter.
      const origLog = console.log;
      const origWrite = process.stdout.write.bind(process.stdout);
      const restore = () => {
        console.log = origLog;
        process.stdout.write = origWrite;
      };
      try {
        console.log = () => {};
        process.stdout.write = (() => true) as typeof process.stdout.write;
        await closeSlice(closeArgs);
        restore();
        process.stderr.write(`auto-closed ${activeTask.id}\n`);
        autoCloseAttempt = { sliceId: activeTask.id, attempted: true, closed: true };
        // Refresh maintain and backlog so the handover reflects the new state
        [maintain, backlog] = await Promise.all([
          collectMaintenancePlan(options.project, options.base, options.repo),
          collectBacklog(options.project),
        ]);
      } catch (err) {
        restore();
        const reason = err instanceof Error ? err.message : String(err);
        autoCloseAttempt = { sliceId: activeTask.id, attempted: true, closed: false, reason };
      }
    }
  }

  const dirty = await collectDirtyRepoStatus(maintain.repo);
  const [recentCommits, commitsSinceBase] = await Promise.all([
    collectRecentCommits(maintain.repo, 5),
    collectCommitsSinceBase(maintain.repo, options.base, 20),
  ]);
  const pipelineProgress = maintain.focus.activeTask
    ? await readSlicePipelineProgress(options.project, maintain.focus.activeTask.id)
    : null;
  const recentEvents = await projectLogEntries(options.project);
  const recentNotes = recentEvents.filter((e) => e.includes("] note |"));
  const lifecycleEvents = recentEvents.filter((e) => !e.includes("] note |"));
  const result = {
    project: options.project,
    repo: maintain.repo,
    base: options.base,
    focus: maintain.focus,
    backlog: Object.fromEntries(Object.entries(backlog.sections).map(([section, items]) => [section, items.length])),
    dirty,
    sessionActivity,
    recentCommits,
    commitsSinceBase,
    pipelineProgress,
    lifecycleEvents: lifecycleEvents.map(compactLogEntry),
    actions: maintain.actions.slice(0, 12),
    recentNotes: recentNotes.map(compactLogEntry),
    autoCloseAttempt,
  };
  const nextSessionPrompt = buildNextSessionPrompt(result);

  let handoverPath: string | null = null;
  if (!noWrite) {
    handoverPath = await writeHandoverFile(result, nextSessionPrompt, harness);
  }

  if (json) {
    console.log(JSON.stringify({ ...result, nextSessionPrompt, ...(handoverPath ? { handoverPath: relative(VAULT_ROOT, handoverPath) } : {}) }, null, 2));
    return;
  }
  console.log(`handover for ${options.project}:`);
  const handoverRel = handoverPath ? relative(VAULT_ROOT, handoverPath) : null;
  console.log(
    handoverRel
      ? `→ NEXT SESSION PROMPT appears at the END of this output. If truncated, cat ${handoverRel}`
      : `→ NEXT SESSION PROMPT appears at the END of this output. Re-run with --json to parse it programmatically.`,
  );
  console.log("");
  console.log("--- session context ---");
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  if (autoCloseAttempt?.attempted) {
    if (autoCloseAttempt.closed) {
      console.log(`- auto-close: ${autoCloseAttempt.sliceId} closed`);
    } else {
      console.log(`- auto-close: ${autoCloseAttempt.sliceId} skipped (${autoCloseAttempt.reason})`);
    }
  }
  if (result.focus.activeTask) console.log(`- active: ${result.focus.activeTask.id} ${result.focus.activeTask.title}`);
  else if (result.focus.recommendedTask) console.log(`- next: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
  console.log(`- backlog: ${Object.entries(result.backlog).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  if (dirty.modifiedFiles.length || dirty.untrackedFiles.length || dirty.stagedFiles.length) {
    console.log(`- dirty: modified=${dirty.modifiedFiles.length} untracked=${dirty.untrackedFiles.length} staged=${dirty.stagedFiles.length}`);
  }
  for (const warning of result.focus.warnings) console.log(`- warning: ${warning}`);
  renderSessionActivity(sessionActivity);
  if (recentCommits.length) {
    console.log(`- recent commits:`);
    for (const commit of recentCommits) console.log(`    ${commit}`);
  }
  if (commitsSinceBase.length) {
    console.log(`- commits since base:`);
    for (const commit of commitsSinceBase.slice(0, 10)) console.log(`    ${commit}`);
  }
  if (lifecycleEvents.length) {
    console.log(`- recent activity:`);
    for (const entry of lifecycleEvents.slice(0, 8)) console.log(`    ${compactLogEntry(entry)}`);
  }
  if (result.actions.length) {
    console.log(`- next actions:`);
    for (const action of result.actions.slice(0, 8)) console.log(`    [${action.kind}] ${action.message}`);
  }
  if (recentNotes.length) {
    console.log(`- agent notes:`);
    for (const entry of recentNotes) console.log(`    ${compactLogEntry(entry)}`);
  }
  console.log("");
  console.log("--- next session prompt ---");
  console.log(nextSessionPrompt);
  if (handoverRel) console.log(`\nhandover written: ${handoverRel}`);
}
