import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { projectRoot, safeMatter } from "../cli-shared";
import { parseProjectRepoBaseArgs } from "../git-utils";
import { exists, readText } from "../lib/fs";
import { readSliceHandoff } from "../lib/slice-progress";
import { collectSessionActivity, resolveSessionId } from "../lib/tracker";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { collectMaintenancePlan } from "../maintenance";
import { collectDriftSummary } from "../lib/drift-query";
import { loadLintingSnapshot } from "../verification";
import { applyDerivedLedger } from "../lib/forge-ledger-detect";
import { validateForgeWorkflowLedger, type ForgePhase } from "../lib/forge-ledger";
import { phaseRecommendation } from "../lib/forge-phase-commands";
import { collectForgeStatus } from "../slice/forge";
import {
  collectDirtyRepoStatus,
  collectRecentCommits,
  compactLogEntry,
  projectLogEntries,
  renderSessionActivity,
} from "./_shared";

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
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const repo = await resolveRepoPath(options.project, options.repo);
  await assertGitRepo(repo);
  const lintingSnapshot = await loadLintingSnapshot(options.project);
  const [maintain, drift, sessionActivity, latestHandoverPath] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, repo),
    collectDriftSummary(options.project, repo, lintingSnapshot),
    collectSessionActivity(options.project, resolveSessionId()),
    findLatestHandover(options.project),
  ]);
  const handoff = maintain.focus.activeTask
    ? await readSliceHandoff(options.project, maintain.focus.activeTask.id)
    : null;

  // PRD-056: detect workflow next phase via artifact detection for the active/next slice.
  // Degrades gracefully — never throws; null means detection was skipped or failed.
  const focusSliceId = maintain.focus.activeTask?.id ?? maintain.focus.recommendedTask?.id ?? null;
  let workflowNextPhase: string | null = null;
  let focusTriageKind: string | null = null;
  if (focusSliceId) {
    try {
      const { merged } = await applyDerivedLedger({}, options.project, focusSliceId);
      workflowNextPhase = validateForgeWorkflowLedger({ project: options.project, sliceId: focusSliceId, ...merged }).nextPhase;
    } catch {
      // Detection failure is non-fatal; workflowNextPhase stays null
    }
    // Consult the authoritative triage kind so resume agrees with forge status / forge next.
    try {
      const forgeStatus = await collectForgeStatus(options.project, focusSliceId);
      focusTriageKind = forgeStatus.triage.kind;
    } catch {
      // Non-fatal — fall back to legacy resume triage
    }
  }

  const dirty = await collectDirtyRepoStatus(repo);
  const recentCommits = await collectRecentCommits(repo, 5);
  const stalePages = drift.results.filter((row) => row.status !== "fresh").slice(0, 10).map((row) => row.wikiPage);
  const recentNotes = (await projectLogEntries(options.project, "note")).slice(0, 5);

  let handoverMeta: { harness: string | null; agent: string | null; created_at: string | null; status: string | null; nextPriorities: string | null; activeSlices: string[] } | null = null;
  if (latestHandoverPath) {
    const raw = await readText(latestHandoverPath);
    const parsed = safeMatter(relative(VAULT_ROOT, latestHandoverPath), raw, { silent: true });
    if (parsed) {
      const prioritiesMatch = raw.match(/## Next Session Priorities\n\n([\s\S]*?)(?=\n## |\n$)/);
      handoverMeta = {
        harness: typeof parsed.data.harness === "string" ? parsed.data.harness : null,
        agent: typeof parsed.data.agent === "string" ? parsed.data.agent : null,
        created_at: typeof parsed.data.created_at === "string" ? parsed.data.created_at : null,
        status: typeof parsed.data.status === "string" ? parsed.data.status : null,
        nextPriorities: prioritiesMatch?.[1]?.trim() ?? null,
        activeSlices: Array.isArray(parsed.data.active_slices) ? parsed.data.active_slices.map(String) : [],
      };
    }
  }

  const actions = maintain.actions.slice(0, 8);
  // Detect stale handover: if pipeline breadcrumb is newer than the handover file,
  // the previous session likely ended without calling `wiki handover` (e.g., context overflow).
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
    handoverStale,
    noHandoverButBreadcrumb,
    ...(workflowNextPhase !== null ? { workflowNextPhase } : {}),
    triage: classifyResumeTriage(options.project, repo, options.base, maintain.focus.activeTask, maintain.focus.recommendedTask, actions, handoff, workflowNextPhase, focusTriageKind),
    ...(handoff ? { lastForgeRun: handoff } : {}),
    ...(handoverMeta ? { lastHandover: { path: relative(VAULT_ROOT, latestHandoverPath!), ...handoverMeta } } : {}),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  // Decisive format: lead with the ONE command to run. Everything else is context below.
  console.log(`→ ${payload.triage.command}`);
  console.log(`  (${payload.triage.reason})`);
  console.log("");
  if (noHandoverButBreadcrumb) {
    console.log(`⚠  no handover file — resuming from pipeline breadcrumb (previous session ended without wiki handover)`);
    console.log("");
  } else if (handoverStale) {
    console.log(`⚠  handover is stale: pipeline ran at ${handoffIso} after handover at ${handoverIso}`);
    console.log(`   previous session likely ended mid-work; treat breadcrumb as source of truth`);
    console.log("");
  }
  console.log(`resume for ${options.project}:`);
  if (payload.activeTask) console.log(`- active: ${payload.activeTask.id} ${payload.activeTask.title}`);
  else if (payload.nextTask) console.log(`- next: ${payload.nextTask.id} ${payload.nextTask.title}`);
  if (payload.workflowNextPhase !== undefined) {
    console.log(`- workflow next phase: ${payload.workflowNextPhase ?? "complete"}`);
  }
  if (handoff) {
    console.log(`- last forge run: ${handoff.lastForgeOk ? "PASS" : "FAIL"} at ${handoff.lastForgeStep} (${handoff.lastForgeRun})`);
  }
  console.log(`- dirty: modified=${dirty.modifiedFiles.length} staged=${dirty.stagedFiles.length} untracked=${dirty.untrackedFiles.length}`);
  if (handoverMeta) {
    console.log(`- last handover: ${relative(VAULT_ROOT, latestHandoverPath!)} (${handoverMeta.status ?? "unknown"})`);
  }
  if (recentCommits.length) {
    console.log(`- recent commits:`);
    for (const commit of recentCommits.slice(0, 3)) console.log(`  - ${commit}`);
  }
  if (stalePages.length || recentNotes.length || payload.actions.length) {
    console.log("");
    console.log(`context (for reference, not blocking):`);
    for (const page of stalePages) console.log(`- stale: ${page}`);
    for (const note of recentNotes) console.log(`- note: ${compactLogEntry(note)}`);
    if (payload.actions.length) {
      for (const action of payload.actions) console.log(`- [${action.scope ?? "unspecified"}][${action.kind}] ${action.message}`);
    }
  }
  renderSessionActivity(sessionActivity);
}

function classifyResumeTriage(
  project: string,
  repo: string,
  base: string | undefined,
  activeTask: { id: string } | null | undefined,
  nextTask: { id: string } | null | undefined,
  actions: Array<{ kind: string; message: string; scope?: string }>,
  handoff?: { lastForgeRun?: string; lastForgeStep?: string; lastForgeOk?: boolean; nextAction?: string; failureSummary?: string } | null,
  workflowNextPhase?: string | null,
  focusTriageKind?: string | null,
) {
  const baseFlag = base ? ` --base ${base}` : "";
  const focusTask = activeTask ?? nextTask;
  // Failed-forge breadcrumb takes precedence: operator just lost a run, they need
  // to see WHY, not a re-route to an earlier workflow phase.
  if (activeTask && handoff && handoff.lastForgeOk === false && handoff.nextAction) {
    return {
      kind: "resume-failed-forge",
      reason: handoff.failureSummary ?? `forge run failed at ${handoff.lastForgeStep}`,
      command: `wiki forge run ${project} ${activeTask.id} --repo ${repo}${baseFlag}`,
    };
  }
  // Workflow-phase gate: if the authoritative triage (same one `forge status` / `forge next`
  // use) says the slice needs an earlier phase, recommending `wiki forge run` would
  // claim+fail. Route to the phase-appropriate command. Only gate on `needs-*` kinds.
  if (
    focusTask &&
    workflowNextPhase &&
    workflowNextPhase !== "verify" &&
    focusTriageKind &&
    focusTriageKind.startsWith("needs-")
  ) {
    const rec = phaseRecommendation(project, focusTask.id, workflowNextPhase as ForgePhase);
    return { kind: rec.kind, reason: rec.reason, command: rec.command };
  }
  // Agent surface is 3 commands: plan, run, next. Any active slice → run it.
  if (activeTask) {
    return {
      kind: "continue-active-slice",
      reason: `active slice ${activeTask.id} is the current focus`,
      command: `wiki forge run ${project} ${activeTask.id} --repo ${repo}${baseFlag}`,
    };
  }
  if (nextTask) {
    return {
      kind: "start-next-slice",
      reason: `no slice is active; ${nextTask.id} is the next ready slice`,
      command: `wiki forge run ${project} ${nextTask.id} --repo ${repo}${baseFlag}`,
    };
  }
  return {
    kind: "plan-next",
    reason: "no active or ready slice was found",
    command: `wiki forge next ${project}`,
  };
}
