import { requireValue } from "../cli-shared";
import { tailLog } from "../lib/log";
import { collectSessionActivity, resolveSessionId } from "../lib/tracker";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { collectBacklog, collectBacklogFocus } from "./backlog";
import { collectMaintenancePlan, resolveDefaultBase } from "./maintenance";
import { collectDriftSummary } from "./verification";

type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

async function parseProjectRepoBaseArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : await resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  return { project, repo, base };
}

async function collectDirtyRepoStatus(repo: string): Promise<DirtyRepoStatus> {
  await assertGitRepo(repo);
  const proc = await Bun.$`git status --porcelain --untracked-files=all`.cwd(repo).quiet().nothrow();
  if (proc.exitCode !== 0) throw new Error(`git status failed for ${repo}`);
  const modifiedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  const stagedFiles: string[] = [];
  for (const line of proc.text().replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim().replaceAll("\\", "/");
    if (status === "??") {
      untrackedFiles.push(file);
      continue;
    }
    if (status[0] && status[0] !== " ") stagedFiles.push(file);
    if (status[1] && status[1] !== " ") modifiedFiles.push(file);
    else if (!stagedFiles.includes(file)) modifiedFiles.push(file);
  }
  return {
    modifiedFiles: [...new Set(modifiedFiles)].sort(),
    untrackedFiles: [...new Set(untrackedFiles)].sort(),
    stagedFiles: [...new Set(stagedFiles)].sort(),
  };
}

async function collectRecentCommits(repo: string, limit: number) {
  const proc = await Bun.$`git log -n${limit} --oneline`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return [] as string[];
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

async function projectLogEntries(project: string, kind?: string) {
  return (await tailLog(50))
    .filter((entry) => entry.includes(`- project: ${project}`))
    .filter((entry) => !kind || entry.includes(`] ${kind} |`))
    .slice(-10)
    .reverse();
}

function compactLogEntry(entry: string) {
  const lines = entry.split("\n").map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.replace(/^##\s+/u, "") ?? entry;
  const details = lines.slice(1).filter((line) => !line.startsWith("- project: "));
  return [header, ...details].join(" | ");
}

function buildNextSessionPrompt(result: {
  project: string;
  repo: string;
  base: string;
  focus: { activeTask: { id: string; title: string } | null; recommendedTask: { id: string; title: string } | null; warnings: string[] };
  dirty: { modifiedFiles: string[]; untrackedFiles: string[]; stagedFiles: string[] };
  actions: Array<{ kind: string; message: string }>;
  recentNotes: string[];
  recentCommits: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Continue work on ${result.project}. Repo: ${result.repo}`);
  lines.push(`Start with: wiki resume ${result.project} --repo ${result.repo} --base ${result.base}`);
  lines.push("");

  // dirty state warning
  if (result.dirty.modifiedFiles.length || result.dirty.untrackedFiles.length) {
    lines.push(`Warning: ${result.dirty.modifiedFiles.length} modified, ${result.dirty.untrackedFiles.length} untracked files — review and commit or discard before starting new work.`);
  }

  // what to work on
  if (result.focus.activeTask) {
    lines.push(`Active slice: ${result.focus.activeTask.id} — ${result.focus.activeTask.title}. Continue this first.`);
  } else if (result.focus.recommendedTask) {
    lines.push(`Next slice: ${result.focus.recommendedTask.id} — ${result.focus.recommendedTask.title}. Start with wiki start-slice.`);
  }

  // top priorities from actions (skip move-doc-to-wiki noise)
  const priorityActions = result.actions.filter((a) => !a.kind.startsWith("move-doc")).slice(0, 3);
  if (priorityActions.length) {
    lines.push("");
    lines.push("Priorities:");
    for (const action of priorityActions) lines.push(`- [${action.kind}] ${action.message}`);
  }

  // most recent note (context from previous agent)
  if (result.recentNotes.length) {
    lines.push("");
    lines.push(`Previous agent note: ${result.recentNotes[0]}`);
  }

  return lines.join("\n");
}

function renderSessionActivity(activity: import("../lib/tracker").SessionSummary) {
  if (activity.totalCommands === 0) return;
  const span = activity.durationMinutes > 0 ? `, ~${activity.durationMinutes}min` : "";
  console.log(`- session (${activity.totalCommands} commands${span}):`);
  const counts = Object.entries(activity.commandCounts).map(([k, n]) => `${k}=${n}`).join(" ");
  if (counts) console.log(`    ${counts}`);
  const closed = activity.sliceTransitions.filter((e) => e.cmd === "close-slice" && e.ok).map((e) => e.target);
  if (closed.length) console.log(`    closed: ${closed.join(", ")}`);
  const started = activity.sliceTransitions.filter((e) => e.cmd === "start-slice" && e.ok).map((e) => e.target);
  if (started.length) console.log(`    started: ${started.join(", ")}`);
  for (const err of activity.errors.slice(0, 5)) {
    console.log(`    failed: ${err.cmd}${err.target ? ` ${err.target}` : ""} (${err.error})`);
  }
}

export async function nextProject(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const focus = await collectBacklogFocus(project);
  const recommendation = focus.activeTask
    ? { ...focus.activeTask, reason: "continue the active slice" }
    : focus.recommendedTask
      ? { ...focus.recommendedTask, reason: "next ready slice from backlog" }
      : null;

  let actions: Array<{ kind: string; message: string }> = [];
  let repo: string | undefined;
  let base: string | undefined;
  try {
    repo = await resolveRepoPath(project);
    await assertGitRepo(repo);
    base = await resolveDefaultBase(project, repo);
    actions = (await collectMaintenancePlan(project, base, repo)).actions.slice(0, 5);
  } catch {}

  const result = { project, repo, base, recommendation, warnings: focus.warnings, actions };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!recommendation) {
    console.log(`no ready slice found for ${project}`);
    return;
  }
  console.log(`${recommendation.id} ${recommendation.title}`);
  console.log(`- ${recommendation.reason}`);
  if (recommendation.hasSliceDocs) console.log(`- plan=${recommendation.planStatus} test-plan=${recommendation.testPlanStatus}`);
  for (const warning of focus.warnings) console.log(`- warning: ${warning}`);
  for (const action of actions) console.log(`- ${action.kind}: ${action.message}`);
}

export async function handoverProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const [maintain, backlog, sessionActivity] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, options.repo),
    collectBacklog(options.project),
    collectSessionActivity(options.project, resolveSessionId()),
  ]);
  const dirty = await collectDirtyRepoStatus(maintain.repo);
  const recentCommits = await collectRecentCommits(maintain.repo, 5);
  const recentEvents = await projectLogEntries(options.project); // all events, not just notes
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
    lifecycleEvents: lifecycleEvents.map(compactLogEntry),
    actions: maintain.actions.slice(0, 12),
    recentNotes: recentNotes.map(compactLogEntry),
  };
  const nextSessionPrompt = buildNextSessionPrompt(result);
  if (json) {
    console.log(JSON.stringify({ ...result, nextSessionPrompt }, null, 2));
    return;
  }
  console.log(`handover for ${options.project}:`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  // --- what's happening now ---
  if (result.focus.activeTask) console.log(`- active: ${result.focus.activeTask.id} ${result.focus.activeTask.title}`);
  else if (result.focus.recommendedTask) console.log(`- next: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
  console.log(`- backlog: ${Object.entries(result.backlog).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  if (dirty.modifiedFiles.length || dirty.untrackedFiles.length || dirty.stagedFiles.length) {
    console.log(`- dirty: modified=${dirty.modifiedFiles.length} untracked=${dirty.untrackedFiles.length} staged=${dirty.stagedFiles.length}`);
  }
  for (const warning of result.focus.warnings) console.log(`- warning: ${warning}`);
  // --- what happened ---
  renderSessionActivity(sessionActivity);
  if (recentCommits.length) {
    console.log(`- recent commits:`);
    for (const commit of recentCommits) console.log(`    ${commit}`);
  }
  if (lifecycleEvents.length) {
    console.log(`- recent activity:`);
    for (const entry of lifecycleEvents.slice(0, 8)) console.log(`    ${compactLogEntry(entry)}`);
  }
  // --- what to do next ---
  if (result.actions.length) {
    console.log(`- next actions:`);
    for (const action of result.actions.slice(0, 8)) console.log(`    [${action.kind}] ${action.message}`);
  }
  // --- context from previous agents ---
  if (recentNotes.length) {
    console.log(`- agent notes:`);
    for (const entry of recentNotes) console.log(`    ${compactLogEntry(entry)}`);
  }
  // --- next session prompt ---
  console.log("");
  console.log("--- next session prompt ---");
  console.log(buildNextSessionPrompt(result));
}

export async function resumeProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const repo = await resolveRepoPath(options.project, options.repo);
  await assertGitRepo(repo);
  const [maintain, drift, sessionActivity] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, repo),
    collectDriftSummary(options.project, repo),
    collectSessionActivity(options.project, resolveSessionId()),
  ]);
  const dirty = await collectDirtyRepoStatus(repo);
  const recentCommits = await collectRecentCommits(repo, 5);
  const stalePages = drift.results.filter((row) => row.status !== "fresh").slice(0, 10).map((row) => row.wikiPage);
  const recentNotes = (await projectLogEntries(options.project, "note")).slice(0, 5);
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
    actions: maintain.actions.slice(0, 8),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
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
  if (payload.actions.length) {
    console.log(`- next actions:`);
    for (const action of payload.actions) console.log(`  - [${action.kind}] ${action.message}`);
  }
}
