import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { projectRoot, safeMatter } from "../../cli-shared";
import { parseProjectRepoBaseArgs } from "../../git-utils";
import { exists, readText } from "../../lib/fs";
import { isPrePhaseTriage, renderSteeringPacket } from "../../protocol/steering/index";
import { collectSessionActivity, resolveSessionId } from "../shared";
import { assertGitRepo, resolveRepoPath } from "../../lib/verification";
import { collectCheckpoint, collectMaintenancePlan, collapseActions } from "../../maintenance";
import { resolveWorkflowSteering } from "../../protocol";
import { readSliceHandoff } from "../../slice/pipeline/index";
import {
  collectDirtyRepoStatus,
  collectRecentCommits,
  compactLogEntry,
  projectLogEntries,
  renderSessionActivity,
} from "../shared";
import { printError, printJson, printLine } from "../../lib/cli-output";

async function findLatestHandover(project: string): Promise<string | null> {
  const dir = join(projectRoot(project), "handovers");
  if (!await exists(dir)) return null;
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
    if (!files.length) return null;
    return join(dir, files[0]);
  } catch {
    return null;
  }
}

export async function resumeProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args, {
    fallbackToHeadIfUnresolvable: true,
    fallbackLabel: "resume",
  });
  const json = args.includes("--json");
  if (options.baseFallbackNote) printError(options.baseFallbackNote);
  const repo = await resolveRepoPath(options.project, options.repo);
  await assertGitRepo(repo);
  const [maintain, checkpoint, sessionActivity, latestHandoverPath] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, repo),
    collectCheckpoint(options.project, repo, { ...(options.base ? { base: options.base } : {}) }),
    collectSessionActivity(options.project, resolveSessionId()),
    findLatestHandover(options.project),
  ]);
  const handoff = maintain.focus.activeTask ? await readSliceHandoff(options.project, maintain.focus.activeTask.id) : null;
  const steeringResolution = await resolveWorkflowSteering(options.project, {
    repo,
    base: options.base,
    focus: maintain.focus,
    handoff,
  });
  const focusTask = steeringResolution.focusTask;
  const workflowNextPhase = steeringResolution.workflowNextPhase;

  const dirty = await collectDirtyRepoStatus(repo);
  const recentCommits = await collectRecentCommits(repo, 5);
  const stalePages = checkpoint.stalePages.slice(0, 10).map((row) => row.page);
  const recentNotes = (await projectLogEntries(options.project, "note")).slice(0, 5);

  let handoverMeta: {
    harness: string | null;
    agent: string | null;
    created_at: string | null;
    status: string | null;
    nextPriorities: string | null;
    trackedArtifacts: string | null;
    accomplishments: string[];
    blockers: string[];
    activeSlices: string[];
  } | null = null;
  if (latestHandoverPath) {
    const raw = await readText(latestHandoverPath);
    const parsed = safeMatter(relative(VAULT_ROOT, latestHandoverPath), raw, { silent: true });
    if (parsed) {
      const prioritiesMatch = raw.match(/## Next Session Priorities\n\n([\s\S]*?)(?=\n## |\n$)/);
      const artifactsMatch = raw.match(/## Tracked Artifacts\n\n([\s\S]*?)(?=\n## |\n$)/);
      const accomplishmentsMatch = raw.match(/## What Was Accomplished\n\n([\s\S]*?)(?=\n## |\n$)/);
      const blockersMatch = raw.match(/## Blockers & Open Questions\n\n([\s\S]*?)(?=\n## |\n$)/);
      handoverMeta = {
        harness: typeof parsed.data.harness === "string" ? parsed.data.harness : null,
        agent: typeof parsed.data.agent === "string" ? parsed.data.agent : null,
        created_at: typeof parsed.data.created_at === "string" ? parsed.data.created_at : null,
        status: typeof parsed.data.status === "string" ? parsed.data.status : null,
        nextPriorities: prioritiesMatch?.[1]?.trim() ?? null,
        trackedArtifacts: artifactsMatch?.[1]?.trim() ?? null,
        accomplishments: parseHandoverBulletSection(accomplishmentsMatch?.[1]),
        blockers: parseHandoverBulletSection(blockersMatch?.[1]),
        activeSlices: Array.isArray(parsed.data.active_slices) ? parsed.data.active_slices.map(String) : [],
      };
    }
  }

  const actions = maintain.actions.slice(0, 8);
  const actionSummary = collapseActions(maintain.actions).slice(0, 6);
  const handoverIso = handoverMeta?.created_at ?? null;
  const handoffIso = handoff?.lastForgeRun ?? null;
  const handoverStale = Boolean(
    handoverIso && handoffIso && new Date(handoffIso).getTime() > new Date(handoverIso).getTime(),
  );
  const noHandoverButBreadcrumb = !handoverMeta && Boolean(handoff);
  const payload = {
    project: options.project,
    repo,
    base: options.base,
    activeTask: maintain.focus.activeTask,
    nextTask: maintain.focus.recommendedTask,
    dirty,
    sessionActivity,
    recentCommits,
    stalePages,
    recentNotes,
    actions,
    actionSummary,
    actionCount: maintain.actions.length,
    handoverStale,
    noHandoverButBreadcrumb,
    ...(workflowNextPhase !== null ? { workflowNextPhase } : {}),
    triage: steeringResolution.triage,
    steering: steeringResolution.steering,
    ...(handoff ? { lastForgeRun: handoff } : {}),
    ...(handoverMeta ? { lastHandover: { path: relative(VAULT_ROOT, latestHandoverPath!), ...handoverMeta } } : {}),
  };
  if (json) {
    printJson(payload);
    return;
  }
  for (const line of renderSteeringPacket(payload.steering)) printLine(`- ${line}`);
  const showsRecovery =
    payload.triage.kind === "resume-failed-forge" || isPrePhaseTriage(payload.triage);
  const focusId = payload.activeTask?.id ?? payload.nextTask?.id ?? null;
  if (showsRecovery && focusId) {
    printLine(`  recovery: wiki forge release ${options.project} ${focusId}`);
  }
  printLine("");
  if (noHandoverButBreadcrumb) {
    printLine(`⚠  no handover file — resuming from pipeline breadcrumb (previous session ended without wiki handover)`);
    printLine("");
  } else if (handoverStale) {
    printLine(`⚠  handover is stale: pipeline ran at ${handoffIso} after handover at ${handoverIso}`);
    printLine(`   previous session likely ended mid-work; treat breadcrumb as source of truth`);
    printLine("");
  }
  printLine(`resume for ${options.project}:`);
  if (payload.activeTask) printLine(`- active: ${payload.activeTask.id} ${payload.activeTask.title}`);
  else if (payload.nextTask) printLine(`- next: ${payload.nextTask.id} ${payload.nextTask.title}`);
  if (payload.workflowNextPhase !== undefined) {
    printLine(`- workflow next phase: ${payload.workflowNextPhase ?? "complete"}`);
  }
  if (handoff) {
    const forgeState = handoff.lastForgeState === "running"
      ? "INCOMPLETE"
      : handoff.lastForgeOk
        ? "PASS"
        : "FAIL";
    printLine(`- last forge run: ${forgeState} at ${handoff.lastForgeStep} (${handoff.lastForgeRun})`);
  }
  printLine(`- dirty: modified=${dirty.modifiedFiles.length} staged=${dirty.stagedFiles.length} untracked=${dirty.untrackedFiles.length}`);
  if (handoverMeta) {
    printLine(`- last handover: ${relative(VAULT_ROOT, latestHandoverPath!)} (${handoverMeta.status ?? "unknown"})`);
    if (handoverMeta.accomplishments.length) {
      printLine(`- handover accomplishments:`);
      for (const line of handoverMeta.accomplishments) {
        printLine(`  - ${line}`);
      }
    }
    if (handoverMeta.blockers.length) {
      printLine(`- handover blockers:`);
      for (const line of handoverMeta.blockers) {
        printLine(`  - ${line}`);
      }
    }
    if (handoverMeta.trackedArtifacts) {
      printLine(`- tracked artifacts:`);
      for (const line of handoverMeta.trackedArtifacts.split("\n")) {
        printLine(`  ${line}`);
      }
    }
  }
  if (recentCommits.length) {
    printLine(`- recent commits:`);
    for (const commit of recentCommits.slice(0, 3)) printLine(`  - ${commit}`);
  }
  if (stalePages.length || recentNotes.length || payload.actionSummary.length) {
    printLine("");
    const hasOnlyBackgroundDebt = stalePages.length === 0 && recentNotes.length === 0;
    printLine(hasOnlyBackgroundDebt ? `background debt (not blocking):` : `context (for reference, not blocking):`);
    for (const page of stalePages) printLine(`- stale: ${page}`);
    for (const note of recentNotes) printLine(`- note: ${compactLogEntry(note)}`);
    if (payload.actionSummary.length) {
      for (const line of payload.actionSummary) printLine(`- ${line}`);
      if (payload.actionCount > payload.actionSummary.length) {
        printLine(`- +${payload.actionCount - payload.actionSummary.length} more action(s); run wiki maintain ${options.project} --repo ${repo}${options.base ? ` --base ${options.base}` : ""} for full detail`);
      }
    }
  }
  renderSessionActivity(sessionActivity);
}

function parseHandoverBulletSection(value: string | undefined) {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^- /u, "").trim());
}
