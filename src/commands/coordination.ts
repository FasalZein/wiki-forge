import { existsSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { appendLogEntry, tailLog } from "../lib/log";
import { extractShellCommandBlocks, readSliceDependencies, readSliceSourcePaths, readSliceTestPlan } from "../lib/slices";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { projectSlicesDir, projectTaskHubPath } from "../lib/structure";
import { collectBacklog, collectBacklogFocus, collectTaskContextForId, moveTaskToSection } from "./backlog";
import { collectGate } from "./diagnostics";
import { collectMaintenancePlan, resolveDefaultBase } from "./maintenance";
import { applyVerificationLevel } from "./verification-shared";

type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

type ClaimConflict = {
  taskId: string;
  overlap: string[];
  reason: "in-progress" | "claimed";
  claimedBy?: string;
};

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
    repo = resolveRepoPath(project);
    assertGitRepo(repo);
    base = resolveDefaultBase(project, repo);
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

export async function noteProject(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  let agent = defaultAgentName();
  let sliceId: string | undefined;
  const messageParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--agent":
        agent = args[index + 1] || agent;
        index += 1;
        break;
      case "--slice":
        sliceId = args[index + 1] || undefined;
        index += 1;
        break;
      case "--json":
        break;
      default:
        messageParts.push(arg);
        break;
    }
  }
  const message = messageParts.join(" ").trim();
  requireValue(message || undefined, "message");
  const createdAt = nowIso();
  appendLogEntry("note", message, {
    project,
    details: [`agent=${agent}`, ...(sliceId ? [`slice=${sliceId}`] : []), `at=${createdAt}`],
  });
  const result = { project, agent, sliceId, message, createdAt };
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(`noted for ${project}: ${message}`);
}

export async function handoverProject(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const maintain = await collectMaintenancePlan(options.project, options.base, options.repo);
  const dirty = collectDirtyRepoStatus(maintain.repo);
  const backlog = await collectBacklog(options.project);
  const recentNotes = projectLogEntries(options.project, "note");
  const result = {
    project: options.project,
    repo: maintain.repo,
    base: options.base,
    focus: maintain.focus,
    backlog: Object.fromEntries(Object.entries(backlog.sections).map(([section, items]) => [section, items.length])),
    dirty,
    actions: maintain.actions.slice(0, 12),
    recentNotes,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`handover for ${options.project}:`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  if (result.focus.activeTask) console.log(`- active: ${result.focus.activeTask.id} ${result.focus.activeTask.title}`);
  else if (result.focus.recommendedTask) console.log(`- next: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
  console.log(`- dirty: modified=${dirty.modifiedFiles.length} untracked=${dirty.untrackedFiles.length} staged=${dirty.stagedFiles.length}`);
  for (const warning of result.focus.warnings) console.log(`- warning: ${warning}`);
  if (result.actions.length) {
    console.log(`- next actions:`);
    for (const action of result.actions.slice(0, 8)) console.log(`  - [${action.kind}] ${action.message}`);
  }
  if (recentNotes.length) {
    console.log(`- recent notes:`);
    for (const entry of recentNotes) console.log(`  - ${compactLogEntry(entry)}`);
  }
}

export async function claimSlice(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  let agent = defaultAgentName();
  let repo: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--agent":
        agent = args[index + 1] || agent;
        index += 1;
        break;
      case "--repo":
        repo = args[index + 1] || undefined;
        index += 1;
        break;
      case "--json":
        break;
    }
  }

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);
  const sourcePaths = await readSliceSourcePaths(project, sliceId);
  const blockedBy = await readBlockedDependencies(project, sliceId);
  const conflicts = blockedBy.length ? [] : await collectClaimConflicts(project, sliceId, sourcePaths);
  const dirtyOverlap = resolveDirtyOverlap(project, repo, sourcePaths);
  const claimedAt = conflicts.length === 0 ? nowIso() : null;
  const result = {
    project,
    sliceId,
    agent,
    section: context.section,
    sourcePaths,
    ok: conflicts.length === 0 && blockedBy.length === 0,
    conflicts,
    blockedBy,
    dirtyOverlap,
    claimedAt,
    warning: sourcePaths.length === 0 ? "slice has no source_paths; conflict detection is limited" : null,
  };
  if (blockedBy.length > 0) {
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    throw new Error(`${sliceId} is blocked by unfinished dependencies: ${blockedBy.join(", ")}`);
  }
  if (conflicts.length > 0) {
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    throw new Error(`claim conflict for ${sliceId}`);
  }
  await writeClaimMetadata(project, sliceId, agent, claimedAt!, sourcePaths);
  appendLogEntry("claim", sliceId, { project, details: [`agent=${agent}`, `paths=${sourcePaths.length}`] });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(`claimed ${sliceId} for ${agent}`);
}

export async function verifySlice(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const repoIndex = args.indexOf("--repo");
  const repo = resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  assertGitRepo(repo);
  const json = args.includes("--json");
  const testPlan = await readSliceTestPlan(project, sliceId);
  const commands = extractShellCommandBlocks(testPlan.content);
  if (!commands.length) throw new Error(`no shell command blocks found in ${relative(VAULT_ROOT, testPlan.path)}`);

  const results = commands.map((command) => runVerificationCommand(repo, command));
  const ok = results.every((result) => result.ok);
  if (ok) await applyVerificationLevel(testPlan.path, "test-verified", false, relative(VAULT_ROOT, testPlan.path), true);
  appendLogEntry("verify-slice", sliceId, { project, details: [`commands=${results.length}`, `ok=${ok}`] });
  const payload = { project, sliceId, ok, testPlan: relative(VAULT_ROOT, testPlan.path), commands: results };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`verify-slice ${sliceId}: ${ok ? "PASS" : "FAIL"}`);
    for (const result of results) console.log(`- ${result.ok ? "pass" : "fail"}: ${result.command}`);
  }
  if (!ok) throw new Error(`verify-slice failed for ${sliceId}`);
}

export async function closeSlice(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  const json = args.includes("--json");

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);
  if (!context.hasSliceDocs) throw new Error(`slice docs missing for ${sliceId}`);
  if (context.planStatus !== "ready" || context.testPlanStatus !== "ready") {
    throw new Error(`slice docs are not ready for closeout: plan=${context.planStatus} test-plan=${context.testPlanStatus}`);
  }

  const gate = await collectGate(project, base, repo);
  if (!gate.ok) {
    const failed = { project, sliceId, closed: false, gate, previousSection: context.section };
    if (json) console.log(JSON.stringify(failed, null, 2));
    throw new Error(`gate failed for ${project}`);
  }
  await moveTaskToSection(project, sliceId, "Done");
  await clearClaimMetadata(project, sliceId);
  appendLogEntry("close-slice", sliceId, { project, details: [`base=${base}`] });
  const result = { project, sliceId, closed: true, gate, previousSection: context.section };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`closed ${sliceId}`);
}

function parseProjectRepoBaseArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  return { project, repo, base };
}

function defaultAgentName() {
  return process.env.PI_AGENT_NAME || process.env.CLAUDE_AGENT_NAME || process.env.USER || "agent";
}

function collectDirtyRepoStatus(repo: string): DirtyRepoStatus {
  assertGitRepo(repo);
  const proc = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git status failed for ${repo}`);
  const modifiedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  const stagedFiles: string[] = [];
  for (const line of proc.stdout.toString().replace(/\r\n/g, "\n").split("\n")) {
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

function resolveDirtyOverlap(project: string, explicitRepo: string | undefined, sourcePaths: string[]) {
  if (!sourcePaths.length) return [] as string[];
  try {
    const repo = resolveRepoPath(project, explicitRepo);
    const dirty = collectDirtyRepoStatus(repo);
    const dirtyFiles = new Set([...dirty.modifiedFiles, ...dirty.untrackedFiles, ...dirty.stagedFiles]);
    return sourcePaths.filter((path) => dirtyFiles.has(path));
  } catch {
    return [] as string[];
  }
}

async function readBlockedDependencies(project: string, sliceId: string) {
  const context = await collectTaskContextForId(project, sliceId);
  if (context?.blockedBy.length) return context.blockedBy;
  const dependencies = await readSliceDependencies(project, sliceId);
  if (!dependencies.length) return [] as string[];
  const backlog = await collectBacklog(project);
  const doneIds = new Set((backlog.sections["Done"] ?? []).map((task) => task.id));
  return dependencies.filter((dependency) => !doneIds.has(dependency));
}

async function collectClaimConflicts(project: string, targetSliceId: string, targetSourcePaths: string[]): Promise<ClaimConflict[]> {
  if (!targetSourcePaths.length) return [];
  const overlaps = new Map<string, ClaimConflict>();
  const focus = await collectBacklog(project);
  for (const item of focus.sections["In Progress"] ?? []) {
    if (item.id === targetSliceId) continue;
    const overlap = intersect(targetSourcePaths, await readSliceSourcePaths(project, item.id));
    if (overlap.length) overlaps.set(item.id, { taskId: item.id, overlap, reason: "in-progress" });
  }

  const slicesDir = projectSlicesDir(project);
  if (!existsSync(slicesDir)) return [...overlaps.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
  for (const entry of readdirSync(slicesDir)) {
    if (entry === targetSliceId) continue;
    const indexPath = projectTaskHubPath(project, entry);
    if (!existsSync(indexPath)) continue;
    const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
    const claimedBy = parsed?.data.claimed_by;
    if (typeof claimedBy !== "string" || !claimedBy.trim()) continue;
    const overlap = intersect(targetSourcePaths, await readSliceSourcePaths(project, entry));
    if (!overlap.length) continue;
    const existing = overlaps.get(entry);
    overlaps.set(entry, existing ? { ...existing, claimedBy } : { taskId: entry, overlap, reason: "claimed", claimedBy });
  }
  return [...overlaps.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

function intersect(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).sort();
}

async function writeClaimMetadata(project: string, sliceId: string, agent: string, claimedAt: string, sourcePaths: string[]) {
  const indexPath = projectTaskHubPath(project, sliceId);
  assertExists(indexPath, `slice index not found: ${relative(VAULT_ROOT, indexPath)}`);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath));
  if (!parsed) throw new Error(`could not parse slice index: ${sliceId}`);
  const data = orderFrontmatter({
    ...parsed.data,
    claimed_by: agent,
    claimed_at: claimedAt,
    ...(sourcePaths.length ? { claim_paths: sourcePaths } : {}),
    updated: claimedAt,
  }, ["title", "type", "spec_kind", "project", "source_paths", "task_id", "depends_on", "parent_prd", "parent_feature", "claimed_by", "claimed_at", "claim_paths", "created_at", "updated", "status"]);
  writeNormalizedPage(indexPath, parsed.content, data);
}

async function clearClaimMetadata(project: string, sliceId: string) {
  const indexPath = projectTaskHubPath(project, sliceId);
  if (!existsSync(indexPath)) return;
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!parsed) return;
  const data = { ...parsed.data };
  delete data.claimed_by;
  delete data.claimed_at;
  delete data.claim_paths;
  data.updated = nowIso();
  writeNormalizedPage(indexPath, parsed.content, orderFrontmatter(data, ["title", "type", "spec_kind", "project", "source_paths", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"]));
}

function projectLogEntries(project: string, kind?: string) {
  return tailLog(50)
    .filter((entry) => entry.includes(`- project: ${project}`))
    .filter((entry) => !kind || entry.includes(`] ${kind} |`))
    .slice(-10)
    .reverse();
}

function runVerificationCommand(repo: string, command: string) {
  const proc = Bun.spawnSync(["bash", "-lc", command], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  return {
    command,
    ok: proc.exitCode === 0,
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}

function compactLogEntry(entry: string) {
  const lines = entry.split("\n").map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.replace(/^##\s+/u, "") ?? entry;
  const details = lines.slice(1).filter((line) => !line.startsWith("- project: "));
  return [header, ...details].join(" | ");
}
