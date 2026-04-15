import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, fail, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { agentNamesEqual } from "../lib/agents";
import { appendLogEntry, tailLog } from "../lib/log";
import { extractShellCommandBlocks, readSliceDependencies, readSliceHub, readSlicePlan, readSliceSourcePaths, readSliceStatus, readSliceTestPlan } from "../lib/slices";
import { readVerificationLevel } from "../lib/verification";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { projectSlicesDir, projectTaskHubPath } from "../lib/structure";
import { collectBacklog, collectBacklogFocus, collectTaskContextForId, moveTaskToSection } from "./backlog";
import { collectGate, compactDoctorForJson } from "./diagnostics";
import { collectCloseout, collectMaintenancePlan, isTestFile, resolveDefaultBase } from "./maintenance";
import { writeProjectIndex } from "./index-log";
import { collectDriftSummary } from "./verification";
import { applyVerificationLevel } from "./verification-shared";

type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

type ClaimConflict = {
  taskId: string;
  overlap: string[];
  reason: "in-progress" | "claimed" | "existing-claim";
  claimedBy?: string;
};

type StartSliceDependency = {
  id: string;
  status: string;
  done: boolean;
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

  const result = await collectClaimResult(project, sliceId, agent, repo);
  if (result.blockedBy.length > 0) {
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    fail(`${sliceId} is blocked by unfinished dependencies: ${result.blockedBy.join(", ")}`);
  }
  if (result.conflicts.length > 0) {
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    fail(`claim conflict for ${sliceId}`);
  }
  await writeClaimMetadata(project, sliceId, agent, result.claimedAt!, result.sourcePaths);
  appendLogEntry("claim", sliceId, { project, details: [`agent=${agent}`, `paths=${result.sourcePaths.length}`] });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(`claimed ${sliceId} for ${agent}`);
}

export async function startSlice(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const json = args.includes("--json");
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

  let hub;
  let plan;
  try {
    hub = await readSliceHub(project, sliceId);
    plan = await readSlicePlan(project, sliceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ project, sliceId, status: "missing", agent }, null, 2));
    fail(message.includes("not found") ? `slice not found: ${sliceId}` : message, 3);
  }

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) {
    if (json) console.log(JSON.stringify({ project, sliceId, status: "missing", agent }, null, 2));
    fail(`slice not found in backlog: ${sliceId}`, 3);
  }
  if (context.section === "Done" || hub.data.status === "done") {
    fail(`${sliceId} is already done`, 1);
  }

  const [dependencies, sourcePaths] = await Promise.all([
    collectDependencyStatuses(project, sliceId),
    readSliceSourcePaths(project, sliceId),
  ]);
  const blocking = dependencies.filter((dependency) => !dependency.done);
  const claim = await collectClaimResult(project, sliceId, agent, repo, context, sourcePaths);
  const startedAt = nowIso();
  const planSummary = summarizePlan(hub.content, plan.content, sourcePaths);
  const result = {
    sliceId,
    status: "in-progress",
    agent,
    startedAt,
    dependencies: dependencies.map((dependency) => ({ id: dependency.id, status: dependency.status })),
    claimedPaths: sourcePaths,
    planSummary,
    conflicts: claim.conflicts,
  };

  if (blocking.length > 0) {
    if (json) console.log(JSON.stringify(result, null, 2));
    fail(`${sliceId} is blocked by unfinished dependencies: ${blocking.map((dependency) => dependency.id).join(", ")}`, 1);
  }
  if (claim.conflicts.length > 0) {
    if (json) console.log(JSON.stringify(result, null, 2));
    fail(`claim conflict for ${sliceId}`, 2);
  }

  await moveTaskToSection(project, sliceId, "In Progress");
  await writeClaimMetadata(project, sliceId, agent, startedAt, sourcePaths);
  await markSliceStarted(project, sliceId, startedAt);
  appendLogEntry("start-slice", sliceId, { project, details: [`agent=${agent}`, `started_at=${startedAt}`] });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const dependencySummary = dependencies.length
    ? dependencies.map((dependency) => `${dependency.id} ${dependency.done ? "✓" : `(${dependency.status})`}`).join(", ")
    : "none";
  console.log(`Started ${sliceId} (assignee: ${agent})`);
  console.log(`Dependencies: ${dependencySummary}`);
  console.log(`Claim registered: ${sourcePaths.length ? sourcePaths.join(", ") : "none"}`);
  console.log("---");
  console.log(planSummary);
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

  const results = await Promise.all(commands.map((command) => runVerificationCommand(repo, command)));
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
  const worktree = args.includes("--worktree");
  const force = args.includes("--force");

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);
  if (!context.hasSliceDocs) throw new Error(`slice docs missing for ${sliceId}`);
  if (context.section !== "In Progress") {
    throw new Error(`slice must be In Progress before closeout: ${sliceId} is in ${context.section}`);
  }
  if (context.planStatus !== "ready" || context.testPlanStatus !== "ready") {
    throw new Error(`slice docs are not ready for closeout: plan=${context.planStatus} test-plan=${context.testPlanStatus}`);
  }
  const testPlan = await readSliceTestPlan(project, sliceId);
  const testPlanLevel = readVerificationLevel(testPlan.data);
  if (testPlanLevel !== "test-verified") {
    throw new Error(`slice test-plan must be test-verified before closeout: ${sliceId}`);
  }

  const closeout = await collectCloseout(project, base, repo, undefined, undefined, { worktree });
  const uncoveredChangedCodeFiles = closeout.refreshFromGit.uncoveredFiles.filter((file) => !isTestFile(file));
  const closeoutBlockers = [
    ...closeout.blockers,
    ...(!worktree && closeout.staleImpactedPages.length ? [`${closeout.staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`] : []),
    ...(uncoveredChangedCodeFiles.length ? [`${uncoveredChangedCodeFiles.length} changed code file(s) are not covered by wiki bindings`] : []),
  ];
  if (closeoutBlockers.length > 0 && !force) {
    const failed = {
      project,
      sliceId,
      closed: false,
      previousSection: context.section,
      closeout,
      blockers: closeoutBlockers,
    };
    if (json) console.log(JSON.stringify(failed, null, 2));
    throw new Error(`close-slice prerequisites failed for ${project}`);
  }
  let compactGate: Record<string, unknown> | null = null;
  if (!force) {
    const gate = await collectGate(project, base, repo, { worktree, precomputedCloseout: closeout });
    compactGate = { ...gate, doctor: compactDoctorForJson(gate.doctor) };
    if (!gate.ok) {
      const failed = { project, sliceId, closed: false, gate: compactGate, previousSection: context.section };
      if (json) console.log(JSON.stringify(failed, null, 2));
      throw new Error(`gate failed for ${project}`);
    }
  }
  const completedAt = nowIso();
  await moveTaskToSection(project, sliceId, "Done");
  await markSliceClosed(project, sliceId, completedAt);
  await clearClaimMetadata(project, sliceId);
  await writeProjectIndex(project);
  appendLogEntry("close-slice", sliceId, { project, details: [`base=${base}`, `completed_at=${completedAt}`, ...(force ? ["force=true"] : [])] });
  const result = { project, sliceId, closed: true, ...(compactGate ? { gate: compactGate } : {}), previousSection: context.section, completedAt, force };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`closed ${sliceId}${force ? " (forced)" : ""}`);
}

export async function exportPrompt(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const agentIndex = args.indexOf("--agent");
  const agent = (agentIndex >= 0 ? args[agentIndex + 1] : "codex") || "codex";
  if (!["codex", "claude", "pi"].includes(agent)) throw new Error(`unsupported agent: ${agent}`);
  const summaryPath = join(VAULT_ROOT, "projects", project, "_summary.md");
  const [hub, plan, testPlan, summary, sourcePaths] = await Promise.all([
    readSliceHub(project, sliceId),
    readSlicePlan(project, sliceId),
    readSliceTestPlan(project, sliceId),
    exists(summaryPath).then((e) => e ? readText(summaryPath) : ""),
    readSliceSourcePaths(project, sliceId),
  ]);
  const commands = extractShellCommandBlocks(testPlan.content);
  const context = await collectTaskContextForId(project, sliceId);
  const prompt = renderExecutionPrompt({ project, sliceId, agent, hub, plan, testPlan, summary, sourcePaths, commands, context });
  console.log(prompt);
}

export async function resumeProject(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const repo = resolveRepoPath(options.project, options.repo);
  assertGitRepo(repo);
  const [maintain, drift] = await Promise.all([
    collectMaintenancePlan(options.project, options.base, repo),
    collectDriftSummary(options.project, repo),
  ]);
  const dirty = collectDirtyRepoStatus(repo);
  const recentCommits = await collectRecentCommits(repo, 5);
  const stalePages = drift.results.filter((row) => row.status !== "fresh").slice(0, 10).map((row) => row.wikiPage);
  const recentNotes = projectLogEntries(options.project, "note").slice(0, 5);
  const payload = {
    project: options.project,
    repo,
    base: options.base,
    activeTask: maintain.focus.activeTask,
    nextTask: maintain.focus.recommendedTask,
    dirty,
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
  for (const page of stalePages) console.log(`- stale: ${page}`);
  for (const note of recentNotes) console.log(`- note: ${compactLogEntry(note)}`);
  if (payload.actions.length) {
    console.log(`- next actions:`);
    for (const action of payload.actions) console.log(`  - [${action.kind}] ${action.message}`);
  }
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
  // TODO: migrate to Bun.$ when caller chain is async (resolveDirtyOverlap is sync, blocks full migration)
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

async function collectDependencyStatuses(project: string, sliceId: string): Promise<StartSliceDependency[]> {
  const dependencies = await readSliceDependencies(project, sliceId);
  const results: StartSliceDependency[] = [];
  for (const dependency of dependencies) {
    const context = await collectTaskContextForId(project, dependency);
    const docStatus = await readSliceStatus(project, dependency);
    const done = context?.section === "Done" || docStatus === "done";
    const status = done
      ? "done"
      : context?.section === "In Progress"
        ? "in-progress"
        : context?.section === "Todo"
          ? "todo"
          : docStatus ?? "missing";
    results.push({ id: dependency, status, done: Boolean(done) });
  }
  return results;
}

async function collectClaimResult(
  project: string,
  sliceId: string,
  agent: string,
  repo: string | undefined,
  context?: Awaited<ReturnType<typeof collectTaskContextForId>> | null,
  sourcePaths?: string[],
) {
  const resolvedContext = context ?? await collectTaskContextForId(project, sliceId);
  if (!resolvedContext) fail(`slice not found in backlog: ${sliceId}`, 3);
  const resolvedSourcePaths = sourcePaths ?? await readSliceSourcePaths(project, sliceId);
  const blockedBy = await readBlockedDependencies(project, sliceId);
  const conflicts = blockedBy.length ? [] : await collectClaimConflicts(project, sliceId, agent, resolvedSourcePaths);
  const dirtyOverlap = resolveDirtyOverlap(project, repo, resolvedSourcePaths);
  const claimedAt = conflicts.length === 0 ? nowIso() : null;
  return {
    project,
    sliceId,
    agent,
    section: resolvedContext.section,
    sourcePaths: resolvedSourcePaths,
    ok: conflicts.length === 0 && blockedBy.length === 0,
    conflicts,
    blockedBy,
    dirtyOverlap,
    claimedAt,
    warning: resolvedSourcePaths.length === 0 ? "slice has no source_paths; conflict detection is limited" : null,
  };
}

async function collectClaimConflicts(project: string, targetSliceId: string, agent: string, targetSourcePaths: string[]): Promise<ClaimConflict[]> {
  const overlaps = new Map<string, ClaimConflict>();
  const targetHub = await readSliceHub(project, targetSliceId);
  const existingClaimedBy = typeof targetHub.data.claimed_by === "string" ? targetHub.data.claimed_by.trim() : "";
  if (existingClaimedBy && !agentNamesEqual(existingClaimedBy, agent)) {
    overlaps.set(targetSliceId, { taskId: targetSliceId, overlap: targetSourcePaths, reason: "existing-claim", claimedBy: existingClaimedBy });
  }
  if (!targetSourcePaths.length) return [...overlaps.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));

  const focus = await collectBacklog(project);
  for (const item of focus.sections["In Progress"] ?? []) {
    if (item.id === targetSliceId) continue;
    const overlap = intersect(targetSourcePaths, await readSliceSourcePaths(project, item.id));
    if (overlap.length) overlaps.set(item.id, { taskId: item.id, overlap, reason: "in-progress" });
  }

  const slicesDir = projectSlicesDir(project);
  if (!await exists(slicesDir)) return [...overlaps.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
  for (const entry of readdirSync(slicesDir)) {
    if (entry === targetSliceId) continue;
    const indexPath = projectTaskHubPath(project, entry);
    if (!await exists(indexPath)) continue;
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
  if (!await exists(indexPath)) return;
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!parsed) return;
  const data = { ...parsed.data };
  delete data.claimed_by;
  delete data.claimed_at;
  delete data.claim_paths;
  data.updated = nowIso();
  writeNormalizedPage(indexPath, parsed.content, orderFrontmatter(data, ["title", "type", "spec_kind", "project", "source_paths", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"]));
}

async function markSliceStarted(project: string, sliceId: string, startedAt: string) {
  const indexPath = projectTaskHubPath(project, sliceId);
  assertExists(indexPath, `slice index not found: ${relative(VAULT_ROOT, indexPath)}`);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath));
  if (!parsed) throw new Error(`could not parse slice index: ${sliceId}`);
  writeNormalizedPage(indexPath, parsed.content, orderFrontmatter({
    ...parsed.data,
    status: "in-progress",
    started_at: startedAt,
    updated: startedAt,
  }, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "claimed_by", "claimed_at", "claim_paths", "created_at", "updated", "started_at", "completed_at", "status", "verification_level"]));
}

async function markSliceClosed(project: string, sliceId: string, completedAt: string) {
  const docs = [await readSliceHub(project, sliceId), await readSlicePlan(project, sliceId), await readSliceTestPlan(project, sliceId)];
  for (const doc of docs) {
    const nextLevel = doc.data.spec_kind === "test-plan" ? "test-verified" : "code-verified";
    const data = orderFrontmatter({
      ...doc.data,
      status: "done",
      completed_at: completedAt,
      updated: completedAt,
    }, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "claimed_by", "claimed_at", "claim_paths", "created_at", "updated", "completed_at", "status", "verification_level"]);
    writeNormalizedPage(doc.path, doc.content, data);
    await applyVerificationLevel(doc.path, nextLevel, false, relative(VAULT_ROOT, doc.path), true);
  }
}

function summarizePlan(hubContent: string, planContent: string, sourcePaths: string[]) {
  const title = firstMeaningfulLine(hubContent, /^#\s+/u) ?? firstMeaningfulLine(planContent, /^#\s+/u) ?? "Untitled slice";
  const scope = firstSectionLine(planContent, ["Scope", "Task", "Vertical Slice"]);
  const target = firstSectionLine(planContent, ["Target Structure", "Target", "Vertical Slice"]) ?? (sourcePaths.length ? sourcePaths.join(", ") : null);
  const acceptance = firstSectionLine(planContent, ["Acceptance Criteria", "Green Criteria", "Verification Commands"]);
  return [title, scope ? `Scope: ${scope}` : null, target ? `Target: ${target}` : null, acceptance ? `Acceptance: ${acceptance}` : null]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function firstMeaningfulLine(markdown: string, prefix?: RegExp) {
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("> [!")) continue;
    if (prefix) {
      if (!prefix.test(line)) continue;
      return line.replace(prefix, "").trim();
    }
    if (/^[-*]\s+/u.test(line)) return line.replace(/^[-*]\s+/u, "").trim();
    if (/^\d+\.\s+/u.test(line)) return line.replace(/^\d+\.\s+/u, "").trim();
    if (!line.startsWith("#")) return line;
  }
  return null;
}

function firstSectionLine(markdown: string, headings: string[]) {
  for (const heading of headings) {
    const lines = markdown.split("\n");
    let inSection = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!inSection) {
        if (line.toLowerCase() === `## ${heading}`.toLowerCase()) inSection = true;
        continue;
      }
      if (/^##\s+/u.test(line)) break;
      if (!line || line.startsWith("> [!")) continue;
      if (/^[-*]\s+/u.test(line)) return line.replace(/^[-*]\s+/u, "").trim();
      if (/^\d+\.\s+/u.test(line)) return line.replace(/^\d+\.\s+/u, "").trim();
      return line;
    }
  }
  return null;
}

function renderExecutionPrompt(input: {
  project: string;
  sliceId: string;
  agent: string;
  hub: Awaited<ReturnType<typeof readSliceHub>>;
  plan: Awaited<ReturnType<typeof readSlicePlan>>;
  testPlan: Awaited<ReturnType<typeof readSliceTestPlan>>;
  summary: string;
  sourcePaths: string[];
  commands: string[];
  context: Awaited<ReturnType<typeof collectTaskContextForId>>;
}) {
  const title = typeof input.hub.data.title === "string" ? input.hub.data.title : input.sliceId;
  const assignee = typeof input.hub.data.assignee === "string" ? input.hub.data.assignee : null;
  const summaryBody = input.summary.replace(/^---[\s\S]*?---\s*/u, "").trim();
  const baseSections = [
    `Task: ${title}`,
    `Project: ${input.project}`,
    assignee ? `Intended assignee: ${assignee}` : null,
    "",
    "Context:",
    summaryBody ? summaryBody.slice(0, 1200) : "- Read projects/_summary first.",
    "",
    "Slice Hub:",
    input.hub.content.trim(),
    "",
    "Execution Plan:",
    input.plan.content.trim(),
    "",
    "Test Plan:",
    input.testPlan.content.trim(),
    "",
    "Source Paths:",
    ...(input.sourcePaths.length ? input.sourcePaths.map((path) => `- ${path}`) : ["- none bound yet"]),
    "",
    "Verification:",
    ...(input.commands.length ? input.commands.map((command) => `- ${command}`) : ["- Fill verification commands before implementation ends."]),
    "",
    "Rules:",
    "- Do not write ad hoc markdown into the project repo.",
    "- Keep changes scoped to this slice.",
    "- Update tests with code unless this is an explicit structural refactor.",
    "- Run the listed verification commands before handing back.",
  ].filter((line): line is string => line !== null);

  if (input.agent === "claude") {
    return [
      "You are continuing an in-flight wiki-forge slice.",
      "Stay within the described slice boundary and finish implementation plus verification.",
      "",
      ...baseSections,
      "",
      "Deliverable:",
      "- Return a concise summary of code changes, tests run, and any wiki follow-up required.",
    ].join("\n");
  }

  if (input.agent === "pi") {
    return [
      "You are pi continuing a tracked wiki-forge slice.",
      "Operate directly in the repo, keep changes inside the slice boundary, and finish with verification.",
      "",
      ...baseSections,
      "",
      "Pi-specific expectations:",
      "- Read the referenced files before editing them.",
      "- Keep the repo clean and avoid ad hoc markdown in the project repo.",
      "- Report the exact verification commands you ran.",
    ].join("\n");
  }

  return [
    "Implement this slice in the repo and stop only after tests/verification are done.",
    "Use the provided plan/test-plan as the contract.",
    "",
    ...baseSections,
    "",
    "Output format:",
    "- summary of files changed",
    "- verification commands run + results",
    "- follow-up blockers, if any",
  ].join("\n");
}

async function collectRecentCommits(repo: string, limit: number) {
  const proc = await Bun.$`git log -n${limit} --oneline`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return [] as string[];
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function projectLogEntries(project: string, kind?: string) {
  return tailLog(50)
    .filter((entry) => entry.includes(`- project: ${project}`))
    .filter((entry) => !kind || entry.includes(`] ${kind} |`))
    .slice(-10)
    .reverse();
}

async function runVerificationCommand(repo: string, command: string) {
  const proc = await Bun.$`bash -lc ${command}`.cwd(repo).nothrow().quiet();
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
