import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, projectRoot, safeMatter } from "../cli-shared";
import { ensureDir, exists, readText, writeText } from "../lib/fs";
import { renderHandoverAlignmentReminder } from "../lib/protocol-source";
import { tailLog } from "../lib/log";
import { type SessionSummary, resolveAgent, resolveSessionId } from "../lib/tracker";
import { type DirtyRepoStatus, collectDirtyRepoStatus } from "../lib/dirty-repo";

export type { DirtyRepoStatus };
export { collectDirtyRepoStatus };

export async function collectRecentCommits(repo: string, limit: number) {
  const proc = await Bun.$`git log -n${limit} --oneline`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return [] as string[];
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function collectCommitsSinceBase(repo: string, base: string | undefined, limit: number): Promise<string[]> {
  if (!base) return [];
  const proc = await Bun.$`git log --oneline ${base}..HEAD -n ${limit}`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return [];
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function projectLogEntries(project: string, kind?: string) {
  return (await tailLog(50))
    .filter((entry) => entry.includes(`- project: ${project}`))
    .filter((entry) => !kind || entry.includes(`] ${kind} |`))
    .slice(-10)
    .reverse();
}

export function compactLogEntry(entry: string) {
  const lines = entry.split("\n").map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.replace(/^##\s+/u, "") ?? entry;
  const details = lines.slice(1).filter((line) => !line.startsWith("- project: "));
  return [header, ...details].join(" | ");
}

export function renderSessionActivity(activity: SessionSummary) {
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

export type HandoverResult = {
  project: string;
  repo: string;
  base: string;
  focus: { activeTask: { id: string; title: string } | null; recommendedTask: { id: string; title: string } | null; warnings: string[] };
  dirty: DirtyRepoStatus;
  sessionActivity: SessionSummary;
  recentCommits: string[];
  lifecycleEvents: string[];
  actions: Array<{ kind: string; message: string }>;
  recentNotes: string[];
};

export async function writeHandoverFile(result: HandoverResult, nextSessionPrompt: string, harness?: string): Promise<string> {
  const sid = resolveSessionId();
  const agent = resolveAgent() ?? "unknown";
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(projectRoot(result.project), "handovers");
  await ensureDir(dir);
  const filename = `${date}-${sid.replace(/[^a-zA-Z0-9-]/g, "-")}.md`;
  const filePath = join(dir, filename);

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
  lines.push("> [!note] Agent alignment");
  lines.push(`> ${renderHandoverAlignmentReminder(result.project)}`);
  lines.push("");
  lines.push("## Next Session Priorities");
  lines.push("");
  lines.push(nextSessionPrompt);
  lines.push("");
  lines.push("## What Was Accomplished");
  lines.push("");
  lines.push("<!-- LLM: fill in what was accomplished during this session -->");
  lines.push("");
  lines.push("## Blockers & Open Questions");
  lines.push("");
  lines.push("<!-- LLM: fill in any blockers or open questions -->");
  lines.push("");
  lines.push("## Session Summary");
  lines.push("");
  const span = result.sessionActivity.durationMinutes > 0 ? ` (~${result.sessionActivity.durationMinutes}min)` : "";
  lines.push(`- Commands: ${result.sessionActivity.totalCommands}${span}`);
  if (result.sessionActivity.totalCommands > 0) {
    lines.push(`- Breakdown: ${Object.entries(result.sessionActivity.commandCounts).map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }
  lines.push("");
  lines.push("## Recent Commits");
  lines.push("");
  if (result.recentCommits.length) {
    for (const commit of result.recentCommits) lines.push(`- ${commit}`);
  } else {
    lines.push("- (none)");
  }
  lines.push("");
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
