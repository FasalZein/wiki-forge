import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { parseProjectRepoBaseArgs } from "../../git-utils";
import { resolveWorkflowSteering } from "../../protocol";
import { collectSessionActivity, resolveSessionId } from "../shared";
import { collectBacklog } from "../../hierarchy";
import { collectMaintenancePlan } from "../../maintenance";
import { closeSlice } from "../../slice";
import { readVerificationLevel } from "../../lib/verification";
import { readSliceTestPlan } from "../../slice/docs";
import { readSlicePipelineProgress } from "../../slice/pipeline/index";
import {
  buildAccomplishments,
  buildBlockers,
  buildNextSessionPrompt,
  buildShortPrompt,
  type AutoCloseAttempt,
} from "../continuation/handover-narrative";
import {
  collectDirtyRepoStatus,
  collectRecentCommits,
  collectCommitsSinceBase,
  compactLogEntry,
  projectLogEntries,
  renderSessionActivity,
  writeHandoverFile,
} from "../shared";
import { printJson, printLine } from "../../lib/cli-output";

export async function handoverProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const noWrite = args.includes("--no-write");
  const allowAutoOnly = args.includes("--allow-auto-only");
  const noBlockers = args.includes("--no-blockers");
  const harnessIndex = args.indexOf("--harness");
  const harness = harnessIndex >= 0 ? args[harnessIndex + 1] : undefined;
  const authoredAccomplishments = collectRepeatableFlagValues(args, "--accomplished");
  const authoredBlockers = collectRepeatableFlagValues(args, "--blocker");
  validateHandoverInputs({ authoredAccomplishments, authoredBlockers, noBlockers, allowAutoOnly });
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
        console.log = function suppressConsoleLogDuringAutoClose() {
          return;
        };
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
  const steeringResolution = await resolveWorkflowSteering(options.project, {
    repo: maintain.repo,
    base: options.base,
    focus: maintain.focus,
  });
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
    steering: steeringResolution.steering,
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
  const shortPrompt = buildShortPrompt(result);
  const computedAccomplishments = buildAccomplishments(result);
  const computedBlockers = buildBlockers(result);
  const accomplishments = authoredAccomplishments.length
    ? authoredAccomplishments
    : computedAccomplishments;
  const blockers = authoredBlockers.length
    ? authoredBlockers
    : noBlockers
      ? ["No blockers noted."]
      : computedBlockers;
  const handoverMode = authoredAccomplishments.length || authoredBlockers.length || noBlockers
    ? "authored"
    : "auto-only";

  let handoverPath: string | null = null;
  if (!noWrite) {
    handoverPath = await writeHandoverFile(result, { shortPrompt, nextSessionPrompt, accomplishments, blockers, mode: handoverMode }, harness);
  }

  if (json) {
    printJson({
      ...result,
      shortPrompt,
      nextSessionPrompt,
      accomplishments,
      blockers,
      computedAccomplishments,
      computedBlockers,
      handoverMode,
      ...(handoverPath ? { handoverPath: relative(VAULT_ROOT, handoverPath) } : {}),
    });
    return;
  }
  printLine(`handover for ${options.project}:`);
  const handoverRel = handoverPath ? relative(VAULT_ROOT, handoverPath) : null;
  printLine(
    handoverRel
      ? `→ NEXT SESSION PROMPT appears at the END of this output. If truncated, cat ${handoverRel}`
      : `→ NEXT SESSION PROMPT appears at the END of this output. Re-run with --json to parse it programmatically.`,
  );
  printLine("");
  printLine("--- session context ---");
  printLine(`- repo: ${result.repo}`);
  printLine(`- base: ${result.base}`);
  if (autoCloseAttempt?.attempted) {
    if (autoCloseAttempt.closed) {
      printLine(`- auto-close: ${autoCloseAttempt.sliceId} closed`);
    } else {
      printLine(`- auto-close: ${autoCloseAttempt.sliceId} skipped (${autoCloseAttempt.reason})`);
    }
  }
  if (result.focus.activeTask) printLine(`- active: ${result.focus.activeTask.id} ${result.focus.activeTask.title}`);
  else if (result.focus.recommendedTask) printLine(`- next: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
  printLine(`- backlog: ${Object.entries(result.backlog).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  if (dirty.modifiedFiles.length || dirty.untrackedFiles.length || dirty.stagedFiles.length) {
    printLine(`- dirty: modified=${dirty.modifiedFiles.length} untracked=${dirty.untrackedFiles.length} staged=${dirty.stagedFiles.length}`);
  }
  for (const warning of result.focus.warnings) printLine(`- warning: ${warning}`);
  renderSessionActivity(sessionActivity);
  if (recentCommits.length) {
    printLine(`- recent commits:`);
    for (const commit of recentCommits) printLine(`    ${commit}`);
  }
  if (commitsSinceBase.length) {
    printLine(`- commits since base:`);
    for (const commit of commitsSinceBase.slice(0, 10)) printLine(`    ${commit}`);
  }
  if (lifecycleEvents.length) {
    printLine(`- recent activity:`);
    for (const entry of lifecycleEvents.slice(0, 8)) printLine(`    ${compactLogEntry(entry)}`);
  }
  if (result.actions.length) {
    printLine(`- next actions:`);
    for (const action of result.actions.slice(0, 8)) printLine(`    [${action.kind}] ${action.message}`);
  }
  if (recentNotes.length) {
    printLine(`- agent notes:`);
    for (const entry of recentNotes) printLine(`    ${compactLogEntry(entry)}`);
  }
  printLine("");
  printLine("--- next session prompt ---");
  printLine(nextSessionPrompt);
  if (handoverRel) printLine(`\nhandover written: ${handoverRel}`);
}

function collectRepeatableFlagValues(args: string[], flag: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const raw = args[index + 1];
    const value = raw?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function validateHandoverInputs(input: {
  authoredAccomplishments: string[];
  authoredBlockers: string[];
  noBlockers: boolean;
  allowAutoOnly: boolean;
}) {
  if (input.noBlockers && input.authoredBlockers.length > 0) {
    throw new Error("cannot combine --blocker with --no-blockers");
  }
  void input.allowAutoOnly;
}
