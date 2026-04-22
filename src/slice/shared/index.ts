import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { assertExists, fail, nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { agentNamesEqual } from "../../lib/agents";
import { defaultAgentName } from "../../lib/cli-utils";
import { exists, readText } from "../../lib/fs";
import { projectSlicesDir, projectTaskHubPath } from "../../lib/structure";
import { resolveRepoPath } from "../../lib/verification";
import { collectBacklog, collectTaskContextForId } from "../../hierarchy";
import { collectDirtyRepoStatus } from "../../maintenance/shared";
import { readSliceCanonicalCompletion, readSliceDependencies, readSliceHub, readSliceSourcePaths, readSliceStatus } from "../docs";

export { defaultAgentName };

export type ClaimConflict = {
  taskId: string;
  overlap: string[];
  reason: "in-progress" | "claimed" | "existing-claim";
  claimedBy?: string;
  claimedAt?: string;
};

export type StartSliceDependency = {
  id: string;
  status: string;
  done: boolean;
};

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
    const done = context?.canonicalCompletion ?? await readSliceCanonicalCompletion(project, dependency);
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
    const existingClaimedAt = typeof targetHub.data.claimed_at === "string" ? targetHub.data.claimed_at.trim() : undefined;
    overlaps.set(targetSliceId, { taskId: targetSliceId, overlap: targetSourcePaths, reason: "existing-claim", claimedBy: existingClaimedBy, claimedAt: existingClaimedAt });
  }
  if (!targetSourcePaths.length) return [...overlaps.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));

  const focus = await collectBacklog(project);
  for (const item of focus.sections["In Progress"] ?? []) {
    if (item.id === targetSliceId) continue;
    const inProgressPath = projectTaskHubPath(project, item.id);
    const inProgressParsed = await exists(inProgressPath)
      ? safeMatter(relative(VAULT_ROOT, inProgressPath), await readText(inProgressPath), { silent: true })
      : null;
    const inProgressClaimedBy = typeof inProgressParsed?.data.claimed_by === "string" ? inProgressParsed.data.claimed_by.trim() : undefined;
    const inProgressClaimedAt = typeof inProgressParsed?.data.claimed_at === "string" ? inProgressParsed.data.claimed_at.trim() : undefined;
    const overlap = intersect(targetSourcePaths, await readSliceSourcePaths(project, item.id));
    if (overlap.length) overlaps.set(item.id, { taskId: item.id, overlap, reason: "in-progress", claimedBy: inProgressClaimedBy, claimedAt: inProgressClaimedAt });
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
    const claimedAt = typeof parsed?.data.claimed_at === "string" ? parsed.data.claimed_at.trim() : undefined;
    const overlap = intersect(targetSourcePaths, await readSliceSourcePaths(project, entry));
    if (!overlap.length) continue;
    const existing = overlaps.get(entry);
    overlaps.set(entry, existing ? { ...existing, claimedBy, claimedAt } : { taskId: entry, overlap, reason: "claimed", claimedBy, claimedAt });
  }
  return [...overlaps.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function formatClaimConflictError(sliceId: string, conflicts: ClaimConflict[], project: string, repo?: string): string {
  const lines: string[] = [`cannot start ${sliceId}`];
  for (const conflict of conflicts) {
    lines.push(`blocker: ${conflict.reason} claim on ${conflict.taskId}`);
    if (conflict.claimedBy) lines.push(`  owner: ${conflict.claimedBy}`);
    if (conflict.claimedAt) lines.push(`  claimed_at: ${conflict.claimedAt}`);
  }
  const blocker = conflicts[0];
  const repoArg = repo ? ` --repo ${repo}` : " --repo <path>";
  lines.push("resolution:");
  lines.push(`  - finish the active slice: wiki forge run ${project} ${blocker.taskId}${repoArg}`);
  lines.push(`  - release the claim: wiki forge release ${project} ${blocker.taskId}`);
  lines.push(`  - force takeover: wiki forge start ${project} ${sliceId}${repoArg} --force`);
  return lines.join("\n");
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
