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
    triage: classifyResumeTriage(options.project, repo, options.base, maintain.focus.activeTask, maintain.focus.recommendedTask, actions, handoff),
    ...(handoff ? { lastForgeRun: handoff } : {}),
    ...(handoverMeta ? { lastHandover: { path: relative(VAULT_ROOT, latestHandoverPath!), ...handoverMeta } } : {}),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (handoverMeta) {
    console.log(`last handover: ${relative(VAULT_ROOT, latestHandoverPath!)}`);
    console.log(`  harness=${handoverMeta.harness ?? "unknown"} agent=${handoverMeta.agent ?? "unknown"} created=${handoverMeta.created_at ?? "unknown"} status=${handoverMeta.status ?? "unknown"}`);
    if (handoverMeta.nextPriorities) {
      console.log(`  priorities:`);
      for (const line of handoverMeta.nextPriorities.split("\n").slice(0, 8)) console.log(`    ${line}`);
    }
  }
  if (handoff) {
    console.log(`Last forge run: ${handoff.lastForgeOk ? "PASS" : "FAIL"} at ${handoff.lastForgeStep} (${handoff.lastForgeRun})`);
    if (handoff.nextAction) console.log(`  → ${handoff.nextAction}`);
  }
  console.log(`resume for ${options.project}:`);
  if (payload.activeTask) console.log(`- active: ${payload.activeTask.id} ${payload.activeTask.title}`);
  else if (payload.nextTask) console.log(`- next: ${payload.nextTask.id} ${payload.nextTask.title}`);
  console.log(`- recent commits:`);
  for (const commit of recentCommits) console.log(`  - ${commit}`);
  console.log(`- dirty: modified=${dirty.modifiedFiles.length} staged=${dirty.stagedFiles.length} untracked=${dirty.untrackedFiles.length}`);
  renderSessionActivity(sessionActivity);
  for (const page of stalePages) console.log(`- stale: ${page}`);
  for (const note of recentNotes) console.log(`- note: ${compactLogEntry(note)}`);
  console.log(`- triage: ${payload.triage.kind} -> ${payload.triage.command}`);
  console.log(`  reason: ${payload.triage.reason}`);
  if (payload.actions.length) {
    console.log(`- next actions:`);
    for (const action of payload.actions) console.log(`  - [${action.scope ?? "unspecified"}][${action.kind}] ${action.message}`);
  }
}

function classifyResumeTriage(
  project: string,
  repo: string,
  base: string | undefined,
  activeTask: { id: string } | null | undefined,
  nextTask: { id: string } | null | undefined,
  actions: Array<{ kind: string; message: string; scope?: string }>,
  handoff?: { lastForgeRun?: string; lastForgeStep?: string; lastForgeOk?: boolean; nextAction?: string; failureSummary?: string } | null,
) {
  const baseFlag = base ? ` --base ${base}` : "";
  if (activeTask && handoff && handoff.lastForgeOk === false && handoff.nextAction) {
    return {
      kind: "resume-failed-forge",
      reason: handoff.failureSummary ?? `forge run failed at ${handoff.lastForgeStep}`,
      command: `wiki forge run ${project} ${activeTask.id} --repo ${repo}${baseFlag}`,
    };
  }
  if (activeTask) {
    const sliceAction = actions.find((action) => action.scope === "slice" && action.kind !== "active-task");
    if (sliceAction) {
      return {
        kind: "repair-slice-local",
        reason: sliceAction.message,
        command: `wiki forge check ${project} ${activeTask.id} --repo ${repo}${baseFlag}`,
      };
    }
    const parentAction = actions.find((action) => action.scope === "parent");
    if (parentAction) {
      return {
        kind: "repair-parent",
        reason: parentAction.message,
        command: `wiki forge close ${project} ${activeTask.id} --repo ${repo}${baseFlag}`,
      };
    }
    return {
      kind: "continue-active-slice",
      reason: `active slice ${activeTask.id} is the current focus`,
      command: `wiki forge check ${project} ${activeTask.id} --repo ${repo}${baseFlag}`,
    };
  }
  if (nextTask) {
    return {
      kind: "start-next-slice",
      reason: `no slice is active; ${nextTask.id} is the next ready slice`,
      command: `wiki forge start ${project} ${nextTask.id} --repo ${repo}${baseFlag}`,
    };
  }
  return {
    kind: "maintain-project",
    reason: "no active or ready slice was found",
    command: `wiki maintain ${project} --repo ${repo} --base ${base ?? "HEAD"}`,
  };
}
