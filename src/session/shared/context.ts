import { readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, projectRoot, safeMatter } from "../../cli-shared";
import { ensureDir, exists, readText, writeText } from "../../lib/fs";
import { renderHandoverAlignmentReminder } from "../../protocol/source/index";
import { tailLog } from "../../lib/log";
import type { ForgeSteeringPacket } from "../../protocol/steering/index";
import { type SessionSummary, resolveAgent, resolveSessionId } from "./activity";
import { type DirtyRepoStatus, collectDirtyRepoStatus } from "../../maintenance/shared";
import { resolveBaseRevision } from "../../git-utils";
import {
  projectFeaturePath,
  projectFeaturesDir,
  projectPrdPath,
  projectPrdsDir,
  projectTaskHubPath,
  projectTaskPlanPath,
  projectTaskTestPlanPath,
  toVaultWikilinkPath,
} from "../../lib/structure";
import { printLine } from "../../lib/cli-output";

export type { DirtyRepoStatus };
export { collectDirtyRepoStatus };

export async function collectRecentCommits(repo: string, limit: number) {
  const proc = await Bun.$`git log -n${limit} --oneline`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return [] as string[];
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function collectCommitsSinceBase(repo: string, base: string | undefined, limit: number): Promise<string[]> {
  if (!base) return [];
  const resolvedBase = await resolveBaseRevision(repo, base).catch(() => null);
  if (!resolvedBase) return [];
  const proc = await Bun.$`git log --oneline ${resolvedBase}..HEAD -n ${limit}`.cwd(repo).nothrow().quiet();
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
  printLine(`- session (${activity.totalCommands} commands${span}):`);
  const counts = Object.entries(activity.commandCounts).map(([k, n]) => `${k}=${n}`).join(" ");
  if (counts) printLine(`    ${counts}`);
  const closed = activity.sliceTransitions.filter((e) => e.cmd === "close-slice" && e.ok).map((e) => e.target);
  if (closed.length) printLine(`    closed: ${closed.join(", ")}`);
  const started = activity.sliceTransitions.filter((e) => e.cmd === "start-slice" && e.ok).map((e) => e.target);
  if (started.length) printLine(`    started: ${started.join(", ")}`);
  for (const err of activity.errors.slice(0, 5)) {
    printLine(`    failed: ${err.cmd}${err.target ? ` ${err.target}` : ""} (${err.error})`);
  }
}

type HandoverFocusTask = {
  id: string;
  title: string;
  taskHubPath?: string;
  planPath?: string;
  testPlanPath?: string;
};

export type HandoverResult = {
  project: string;
  repo: string;
  base: string;
  focus: { activeTask: HandoverFocusTask | null; recommendedTask: HandoverFocusTask | null; warnings: string[] };
  steering?: ForgeSteeringPacket | null;
  dirty: DirtyRepoStatus;
  sessionActivity: SessionSummary;
  recentCommits: string[];
  lifecycleEvents: string[];
  actions: Array<{ kind: string; message: string }>;
  recentNotes: string[];
};

export type HandoverContent = {
  shortPrompt: string;
  nextSessionPrompt: string;
  accomplishments: string[];
  blockers: string[];
  mode?: "authored" | "auto-only";
};

export async function writeHandoverFile(result: HandoverResult, content: HandoverContent, harness?: string): Promise<string> {
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
  const activeTask = result.focus.activeTask;
  if (activeTask) {
    activeSlices.push(activeTask.id);
    const hubPath = activeTask.taskHubPath ? join(VAULT_ROOT, activeTask.taskHubPath) : projectTaskHubPath(result.project, activeTask.id);
    if (await exists(hubPath)) {
      const parsed = safeMatter(relative(VAULT_ROOT, hubPath), await readText(hubPath), { silent: true });
      if (parsed?.data.parent_feature) activeFeature = String(parsed.data.parent_feature);
      if (parsed?.data.parent_prd) activePrd = String(parsed.data.parent_prd);
    }
  }
  const trackedArtifacts = await buildTrackedArtifactsSection(result.project, result.focus);

  const targetSlice = activeTask?.id ?? result.focus.recommendedTask?.id ?? null;
  const frontmatter = orderFrontmatter({
    title: `Handover ${date} ${sid}`,
    type: "handover",
    schema_version: 2,
    project: result.project,
    harness: harness ?? null,
    agent,
    session_id: sid,
    created_at: nowIso(),
    handover_complete: true,
    handover_mode: content.mode ?? "auto-only",
    target_slice: targetSlice,
    next_command: result.steering?.nextCommand ?? null,
    workflow_lane: result.steering?.lane ?? null,
    workflow_phase: result.steering?.phase ?? null,
    active_feature: activeFeature,
    active_prd: activePrd,
    active_slices: activeSlices,
    status: "current",
  }, ["title", "type", "schema_version", "project", "harness", "agent", "session_id", "created_at", "handover_complete", "handover_mode", "target_slice", "next_command", "workflow_lane", "workflow_phase", "active_feature", "active_prd", "active_slices", "status"]);

  const lines: string[] = [];
  lines.push(`# Handover — ${date}`);
  lines.push("");
  lines.push("> [!note] Agent alignment");
  lines.push(`> ${renderHandoverAlignmentReminder(result.project)}`);
  lines.push("");
  lines.push("## Short Prompt");
  lines.push("");
  lines.push("```text");
  lines.push(content.shortPrompt);
  lines.push("```");
  lines.push("");
  lines.push("## Next Session Priorities");
  lines.push("");
  lines.push(content.nextSessionPrompt);
  lines.push("");
  if (trackedArtifacts) {
    lines.push("## Tracked Artifacts");
    lines.push("");
    for (const line of trackedArtifacts) lines.push(line);
    lines.push("");
  }
  lines.push("## What Was Accomplished");
  lines.push("");
  for (const item of content.accomplishments) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Blockers & Open Questions");
  lines.push("");
  for (const item of content.blockers) lines.push(`- ${item}`);
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

async function buildTrackedArtifactsSection(
  project: string,
  focus: HandoverResult["focus"],
): Promise<string[] | null> {
  const task = focus.activeTask ?? focus.recommendedTask;
  if (!task) return null;
  const sourceLabel = focus.activeTask ? "Active Slice" : "Recommended Slice";
  const hubPath = task.taskHubPath ? join(VAULT_ROOT, task.taskHubPath) : projectTaskHubPath(project, task.id);
  const planPath = task.planPath ? join(VAULT_ROOT, task.planPath) : projectTaskPlanPath(project, task.id);
  const testPlanPath = task.testPlanPath ? join(VAULT_ROOT, task.testPlanPath) : projectTaskTestPlanPath(project, task.id);

  let parentFeature: string | null = null;
  let parentPrd: string | null = null;
  if (await exists(hubPath)) {
    const parsed = safeMatter(relative(VAULT_ROOT, hubPath), await readText(hubPath), { silent: true });
    if (parsed?.data.parent_feature) parentFeature = String(parsed.data.parent_feature);
    if (parsed?.data.parent_prd) parentPrd = String(parsed.data.parent_prd);
  }

  const featurePath = parentFeature ? await findPlanningDocPath(projectFeaturesDir(project), parentFeature) : null;
  const prdPath = parentPrd ? await findPlanningDocPath(projectPrdsDir(project), parentPrd) : null;
  const featureTitle = featurePath ? await readDocTitle(featurePath, parentFeature ?? "Feature") : parentFeature;
  const prdTitle = prdPath ? await readDocTitle(prdPath, parentPrd ?? "PRD") : parentPrd;
  const taskTitle = await readDocTitle(hubPath, `${task.id} ${task.title}`);

  const lines = [
    `- ${sourceLabel}: ${linkForPath(hubPath, taskTitle)}`,
  ];
  if (featurePath && parentFeature) {
    lines.push(`- Feature: ${linkForPath(featurePath, featureTitle || parentFeature)}`);
  }
  if (prdPath && parentPrd) {
    lines.push(`- PRD: ${linkForPath(prdPath, prdTitle || parentPrd)}`);
  }
  if (await exists(planPath)) {
    lines.push(`- Plan: ${linkForPath(planPath, `${task.id} plan`)}`);
  }
  if (await exists(testPlanPath)) {
    lines.push(`- Test Plan: ${linkForPath(testPlanPath, `${task.id} test plan`)}`);
  }
  return lines;
}

async function findPlanningDocPath(dir: string, id: string): Promise<string | null> {
  if (!await exists(dir)) return null;
  const filename = readdirSync(dir).find((entry: string) => entry.startsWith(`${id}-`) && entry.endsWith(".md"));
  return filename ? join(dir, filename) : null;
}

async function readDocTitle(path: string, fallback: string): Promise<string> {
  if (!await exists(path)) return fallback;
  const parsed = safeMatter(relative(VAULT_ROOT, path), await readText(path), { silent: true });
  if (parsed && typeof parsed.data.title === "string" && parsed.data.title.trim()) {
    return parsed.data.title.trim();
  }
  return fallback || basename(path, ".md");
}

function linkForPath(path: string, label: string) {
  return `[[${toVaultWikilinkPath(path)}|${label}]]`;
}
