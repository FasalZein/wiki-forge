import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, fail, nowIso, orderFrontmatter, requireForceAcknowledgement, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { agentNamesEqual } from "../lib/agents";
import { appendLogEntry } from "../lib/log";
import { extractShellCommandBlocks, readSliceDependencies, readSliceHub, readSlicePlan, readSliceSourcePaths, readSliceStatus, readSliceTestPlan } from "../lib/slices";
import { readVerificationLevel } from "../lib/verification";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { projectSlicesDir, projectTaskHubPath } from "../lib/structure";
import { collectBacklog, collectTaskContextForId, moveTaskToSection } from "../hierarchy/backlog";
import { collectGate, compactDoctorForJson } from "../maintenance/diagnostics";
import { collectCloseout, isTestFile, resolveDefaultBase } from "./maintenance";
import { writeProjectIndex } from "../hierarchy/index-log";
import { applyVerificationLevel } from "../verification/verification-shared";
import { summarizePlan } from "../session/note-export";
import { computeEntityStatus, lifecycleClose, lifecycleOpen } from "./hierarchy-commands";

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

type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

function defaultAgentName() {
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

  // Auto-trigger: open parent PRD/feature if they are not-started
  const parentPrd = typeof hub.data.parent_prd === "string" ? hub.data.parent_prd : null;
  const parentFeature = typeof hub.data.parent_feature === "string" ? hub.data.parent_feature : null;
  if (parentPrd) {
    try {
      await lifecycleOpen(project, parentPrd, "prd");
      process.stderr.write(`auto-started prd ${parentPrd}\n`);
    } catch { /* non-fatal */ }
  }
  if (parentFeature) {
    try {
      await lifecycleOpen(project, parentFeature, "feature");
      process.stderr.write(`auto-started feature ${parentFeature}\n`);
    } catch { /* non-fatal */ }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let dependencySummary: string;
  if (dependencies.length) {
    dependencySummary = dependencies.map((dependency) => {
      const statusLabel = dependency.done ? "✓" : `(${dependency.status})`;
      return `${dependency.id} ${statusLabel}`;
    }).join(", ");
  } else {
    dependencySummary = "none";
  }
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
  const repo = await resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  await assertGitRepo(repo);
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
    for (const result of results) {
      console.log(`- ${result.ok ? "pass" : "FAIL"}: ${result.command} (exit ${result.exitCode})`);
      if (!result.ok) {
        if (result.stderr) {
          for (const line of result.stderr.split("\n").slice(0, 10)) console.log(`    stderr: ${line}`);
        }
        if (result.stdout) {
          for (const line of result.stdout.split("\n").slice(0, 10)) console.log(`    stdout: ${line}`);
        }
      }
    }
    if (!ok) {
      const failedCount = results.filter((r) => !r.ok).length;
      console.log(`\n${failedCount} of ${results.length} verification command(s) failed.`);
      console.log(`Fix the failing commands, then re-run: wiki verify-slice ${project} ${sliceId} --repo <path>`);
    }
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
  const base = baseIndex >= 0 ? args[baseIndex + 1] : await resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  const json = args.includes("--json");
  const worktree = args.includes("--worktree");
  const forceReview = args.includes("--force-review");
  // --force-review is a narrower bypass for closeout REVIEW PASS only; it is
  // already intentionally explicit, so no second-step is required.
  // --force is the superset bypass; it requires --yes-really-force as a
  // two-step acknowledgement to prevent accidental skips.
  const force = forceReview || requireForceAcknowledgement(args, "close-slice");

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);
  if (!context.hasSliceDocs) throw new Error(`slice docs missing for ${sliceId}`);
  if (context.section !== "In Progress") {
    throw new Error(`slice must be In Progress before closeout: ${sliceId} is in ${context.section}`);
  }
  if (context.planStatus !== "ready" || context.testPlanStatus !== "ready") {
    throw new Error(`slice docs are not ready for closeout: plan=${context.planStatus} test-plan=${context.testPlanStatus}`);
  }
  const hub = await readSliceHub(project, sliceId);
  const closeSliceParentPrd = typeof hub.data.parent_prd === "string" ? hub.data.parent_prd : null;
  const closeSliceParentFeature = typeof hub.data.parent_feature === "string" ? hub.data.parent_feature : null;
  const testPlan = await readSliceTestPlan(project, sliceId);
  const testPlanLevel = readVerificationLevel(testPlan.data);
  if (testPlanLevel !== "test-verified") {
    throw new Error(`slice test-plan must be test-verified before closeout: ${sliceId}`);
  }

  const closeout = await collectCloseout(project, base, repo, undefined, undefined, { worktree });
  const uncoveredChangedCodeFiles = closeout.refreshFromGit.uncoveredFiles.filter((file) => !isTestFile(file));
  const reviewPassPending = closeout.ok && closeout.staleImpactedPages.length > 0;
  const closeoutBlockers = [
    ...closeout.blockers,
    ...(!worktree && closeout.staleImpactedPages.length ? [`${closeout.staleImpactedPages.length} impacted page(s) are stale or otherwise drifted (closeout: REVIEW PASS — run: ${closeout.nextSteps.join(" && ")})`] : []),
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
      ...(reviewPassPending ? { reviewPass: true, hint: `closeout is REVIEW PASS with ${closeout.staleImpactedPages.length} stale page(s). Re-run close-slice with --force-review after manual review, or fix the pending steps first.` } : {}),
    };
    if (json) console.log(JSON.stringify(failed, null, 2));
    throw new Error(`close-slice prerequisites failed for ${project}`);
  }
  if (reviewPassPending && forceReview) {
    appendLogEntry("close-slice-force-review", sliceId, {
      project,
      details: [`stale_pages=${closeout.staleImpactedPages.length}`, `base=${base}`],
    });
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

  // Auto-trigger: close parent PRD/feature if their computed status is now complete
  if (closeSliceParentPrd) {
    try {
      await lifecycleClose(project, closeSliceParentPrd, "prd", false);
      process.stderr.write(`auto-closed prd ${closeSliceParentPrd}\n`);
    } catch { /* non-fatal */ }
  }
  if (closeSliceParentFeature) {
    try {
      await lifecycleClose(project, closeSliceParentFeature, "feature", false);
      process.stderr.write(`auto-closed feature ${closeSliceParentFeature}\n`);
    } catch { /* non-fatal */ }
  }

  const forceWarnings: Array<{ label: string; status: string }> = [];
  if (force) {
    if (closeSliceParentPrd) {
      const prdStatus = await computeEntityStatus(project, closeSliceParentPrd, "prd");
      if (prdStatus !== "complete") forceWarnings.push({ label: `parent PRD ${closeSliceParentPrd}`, status: prdStatus });
    }
    if (closeSliceParentFeature) {
      const featureStatus = await computeEntityStatus(project, closeSliceParentFeature, "feature");
      if (featureStatus !== "complete") forceWarnings.push({ label: `parent feature ${closeSliceParentFeature}`, status: featureStatus });
    }
  }

  const result = { project, sliceId, closed: true, ...(compactGate ? { gate: compactGate } : {}), previousSection: context.section, completedAt, force };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`closed ${sliceId}${force ? " (forced)" : ""}`);
    if (force) {
      console.log(`\nWarning: --force skipped closeout and gate checks.`);
      for (const warning of forceWarnings) {
        console.log(`Warning: --force overrode ${warning.label} computed_status="${warning.status}".`);
      }
      if (forceWarnings.length) {
        console.log(`The slice frontmatter now says status=done, but feature-status`);
        console.log(`will still show the parent computed_status values above until child pages`);
        console.log(`are all done AND test-verified.`);
      }
      console.log(`To fully complete the hierarchy:`);
      console.log(`  1. wiki verify-page ${project} <slice-pages> test-verified`);
      console.log(`  2. wiki verify-page ${project} <prd-page> test-verified`);
      console.log(`  3. wiki verify-page ${project} <feature-page> test-verified`);
      console.log(`  4. wiki maintain ${project} --repo <path> --base <rev>`);
      console.log(`  5. wiki feature-status ${project}  # verify computed_status = complete`);
    }
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

async function writeClaimMetadata(project: string, sliceId: string, agent: string, claimedAt: string, sourcePaths: string[]) {
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
  await assertExists(indexPath, `slice index not found: ${relative(VAULT_ROOT, indexPath)}`);
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
