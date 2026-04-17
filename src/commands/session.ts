import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter } from "../cli-shared";
import { parseProjectRepoBaseArgs } from "../git-utils";
import { ensureDir, exists, readText, writeText } from "../lib/fs";
import { tailLog } from "../lib/log";
import { collectSessionActivity, resolveAgent, resolveSessionId } from "../lib/tracker";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { collectBacklog, collectBacklogFocus } from "../hierarchy/backlog";
import { collectMaintenancePlan, resolveDefaultBase } from "./maintenance";
import { collectDriftSummary } from "../verification/verification";

type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

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
  const noWrite = args.includes("--no-write");
  const harnessIndex = args.indexOf("--harness");
  const harness = harnessIndex >= 0 ? args[harnessIndex + 1] : undefined;
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

  // Write durable handover file (WIKI-FORGE-073)
  let handoverPath: string | null = null;
  if (!noWrite) {
    handoverPath = await writeHandoverFile(result, nextSessionPrompt, harness);
  }

  if (json) {
    console.log(JSON.stringify({ ...result, nextSessionPrompt, ...(handoverPath ? { handoverPath: relative(VAULT_ROOT, handoverPath) } : {}) }, null, 2));
    return;
  }
  console.log(`handover for ${options.project}:`);
  // --- top pointer: survives `| head -N` truncation ---
  // Agents default to piping through `tail -N`, which keeps the END. But `head -N`
  // users still need a recovery hint, so the first lines name where the prompt is
  // and point at the durable file.
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
  // --- next session prompt (end, so `| tail -N` keeps it) ---
  console.log("");
  console.log("--- next session prompt ---");
  console.log(nextSessionPrompt);
  if (handoverRel) console.log(`\nhandover written: ${handoverRel}`);
}

async function writeHandoverFile(
  result: {
    project: string;
    repo: string;
    base: string;
    focus: { activeTask: { id: string; title: string } | null; recommendedTask: { id: string; title: string } | null; warnings: string[] };
    dirty: { modifiedFiles: string[]; untrackedFiles: string[]; stagedFiles: string[] };
    sessionActivity: import("../lib/tracker").SessionSummary;
    recentCommits: string[];
    lifecycleEvents: string[];
    actions: Array<{ kind: string; message: string }>;
    recentNotes: string[];
  },
  nextSessionPrompt: string,
  harness?: string,
): Promise<string> {
  const sid = resolveSessionId();
  const agent = resolveAgent() ?? "unknown";
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(projectRoot(result.project), "handovers");
  await ensureDir(dir);
  const filename = `${date}-${sid.replace(/[^a-zA-Z0-9-]/g, "-")}.md`;
  const filePath = join(dir, filename);

  // Derive active feature/PRD from active task hub frontmatter
  let activeFeature: string | null = null;
  let activePrd: string | null = null;
  const activeSlices: string[] = [];
  if (result.focus.activeTask) {
    activeSlices.push(result.focus.activeTask.id);
    const hubPath = join(projectRoot(result.project), "specs", "slices", result.focus.activeTask.id, "index.md");
    if (await exists(hubPath)) {
      const parsed = safeMatter(relative(VAULT_ROOT, hubPath), await readText(hubPath), { silent: true });
      if (parsed?.data.parent_feature) activeFeature = String(parsed.data.parent_feature);
      if (parsed?.data.parent_prd) activePrd = String(parsed.data.parent_prd);
    }
  }

  const frontmatter = orderFrontmatter({
    title: `Handover ${date} ${sid}`,
    type: "handover",
    project: result.project,
    harness: harness ?? null,
    agent,
    session_id: sid,
    created_at: nowIso(),
    active_feature: activeFeature,
    active_prd: activePrd,
    active_slices: activeSlices,
    status: "draft",
  }, ["title", "type", "project", "harness", "agent", "session_id", "created_at", "active_feature", "active_prd", "active_slices", "status"]);

  const lines: string[] = [];
  lines.push(`# Handover — ${date}`);
  lines.push("");

  // Agent alignment callout — stays at top so truncation can't eat it.
  lines.push("> [!note] Agent alignment");
  lines.push("> Read **Next Session Priorities** below BEFORE the session-state sections. If this file is truncated, the priorities block is the minimum you need to resume work. Then load `/wiki` and `/forge` skills before continuing.");
  lines.push("");

  // Pre-filled: Next Session Priorities (moved to top per WIKI-FORGE-101)
  lines.push("## Next Session Priorities");
  lines.push("");
  lines.push(nextSessionPrompt);
  lines.push("");

  // Scaffold: What Was Accomplished (LLM-fill, above auto sections)
  lines.push("## What Was Accomplished");
  lines.push("");
  lines.push("<!-- LLM: fill in what was accomplished during this session -->");
  lines.push("");

  // Scaffold: Blockers & Open Questions
  lines.push("## Blockers & Open Questions");
  lines.push("");
  lines.push("<!-- LLM: fill in any blockers or open questions -->");
  lines.push("");

  // Pre-filled: Session Summary (moved below LLM-fill per WIKI-FORGE-101)
  lines.push("## Session Summary");
  lines.push("");
  const span = result.sessionActivity.durationMinutes > 0 ? ` (~${result.sessionActivity.durationMinutes}min)` : "";
  lines.push(`- Commands: ${result.sessionActivity.totalCommands}${span}`);
  if (result.sessionActivity.totalCommands > 0) {
    lines.push(`- Breakdown: ${Object.entries(result.sessionActivity.commandCounts).map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }
  lines.push("");

  // Pre-filled: Recent Commits
  lines.push("## Recent Commits");
  lines.push("");
  if (result.recentCommits.length) {
    for (const commit of result.recentCommits) lines.push(`- ${commit}`);
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  // Pre-filled: Dirty State
  lines.push("## Dirty State");
  lines.push("");
  if (result.dirty.modifiedFiles.length || result.dirty.untrackedFiles.length || result.dirty.stagedFiles.length) {
    lines.push(`- Modified: ${result.dirty.modifiedFiles.length}`);
    lines.push(`- Untracked: ${result.dirty.untrackedFiles.length}`);
    lines.push(`- Staged: ${result.dirty.stagedFiles.length}`);
  } else {
    lines.push("- Clean working tree");
  }
  lines.push("");

  // Build the file content with frontmatter
  const yamlLines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) yamlLines.push(`${key}: []`);
      else {
        yamlLines.push(`${key}:`);
        for (const item of value) yamlLines.push(`  - '${String(item).replace(/'/g, "''")}'`);
      }
    } else if (value === null) {
      yamlLines.push(`${key}: null`);
    } else if (typeof value === "string" && value.includes(":")) {
      yamlLines.push(`${key}: '${value.replace(/'/g, "''")}'`);
    } else {
      yamlLines.push(`${key}: ${value}`);
    }
  }
  yamlLines.push("---");

  await writeText(filePath, `${yamlLines.join("\n")}\n${lines.join("\n")}`);
  return filePath;
}

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
  const [maintain, drift, sessionActivity, latestHandoverPath] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, repo),
    collectDriftSummary(options.project, repo),
    collectSessionActivity(options.project, resolveSessionId()),
    findLatestHandover(options.project),
  ]);
  const dirty = await collectDirtyRepoStatus(repo);
  const recentCommits = await collectRecentCommits(repo, 5);
  const stalePages = drift.results.filter((row) => row.status !== "fresh").slice(0, 10).map((row) => row.wikiPage);
  const recentNotes = (await projectLogEntries(options.project, "note")).slice(0, 5);

  // Parse latest handover metadata (WIKI-FORGE-074)
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
    ...(handoverMeta ? { lastHandover: { path: relative(VAULT_ROOT, latestHandoverPath!), ...handoverMeta } } : {}),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  // Surface latest handover at top (WIKI-FORGE-074)
  if (handoverMeta) {
    console.log(`last handover: ${relative(VAULT_ROOT, latestHandoverPath!)}`);
    console.log(`  harness=${handoverMeta.harness ?? "unknown"} agent=${handoverMeta.agent ?? "unknown"} created=${handoverMeta.created_at ?? "unknown"} status=${handoverMeta.status ?? "unknown"}`);
    if (handoverMeta.nextPriorities) {
      console.log(`  priorities:`);
      for (const line of handoverMeta.nextPriorities.split("\n").slice(0, 8)) console.log(`    ${line}`);
    }
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
