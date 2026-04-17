import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, fail, nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { agentNamesEqual } from "../lib/agents";
import { readSliceDependencies, readSliceHub, readSliceSourcePaths, readSliceStatus } from "../lib/slices";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { projectSlicesDir, projectTaskHubPath } from "../lib/structure";
import { collectBacklog, collectTaskContextForId } from "../hierarchy/backlog";

export type ClaimConflict = {
  taskId: string;
  overlap: string[];
  reason: "in-progress" | "claimed" | "existing-claim";
  claimedBy?: string;
};

export type StartSliceDependency = {
  id: string;
  status: string;
  done: boolean;
};

export type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

export function defaultAgentName() {
  return process.env.PI_AGENT_NAME || process.env.CLAUDE_AGENT_NAME || process.env.USER || "agent";
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

async function resolveDirtyOverlap(project: string, explicitRepo: string | undefined, sourcePaths: string[]) {
  if (!sourcePaths.length) return [] as string[];
  try {
    const repo = await resolveRepoPath(project, explicitRepo);
    const dirty = await collectDirtyRepoStatus(repo);
    const dirtyFiles = new Set([...dirty.modifiedFiles, ...dirty.untrackedFiles, ...dirty.stagedFiles]);
    return sourcePaths.filter((path) => dirtyFiles.has(path));
  } catch {
    return [] as string[];
  }
}

export async function readBlockedDependencies(project: string, sliceId: string) {
  const context = await collectTaskContextForId(project, sliceId);
  if (context?.blockedBy.length) return context.blockedBy;
  const dependencies = await readSliceDependencies(project, sliceId);
  if (!dependencies.length) return [] as string[];
  const backlog = await collectBacklog(project);
  const doneIds = new Set((backlog.sections["Done"] ?? []).map((task) => task.id));
  return dependencies.filter((dependency) => !doneIds.has(dependency));
}

export async function collectDependencyStatuses(project: string, sliceId: string): Promise<StartSliceDependency[]> {
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

export async function collectClaimResult(
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
  const dirtyOverlap = await resolveDirtyOverlap(project, repo, resolvedSourcePaths);
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

export async function writeClaimMetadata(project: string, sliceId: string, agent: string, claimedAt: string, sourcePaths: string[]) {
  const indexPath = projectTaskHubPath(project, sliceId);
  await assertExists(indexPath, `slice index not found: ${relative(VAULT_ROOT, indexPath)}`);
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
