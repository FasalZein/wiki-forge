import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { assertExists, fail, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { summarizePlan } from "../../lib/slices/plan-summary";
import { projectTaskHubPath } from "../../lib/structure";
import { collectTaskContextForId, lifecycleOpen, moveTaskToSection } from "../../hierarchy";
import { hasCanonicalSliceCompletionEvidence, readSliceHub, readSlicePlan, readSliceSourcePaths } from "../docs";
import { ClaimConflict, collectClaimResult, collectDependencyStatuses, defaultAgentName, formatClaimConflictError, writeClaimMetadata } from "../shared";

export type StartSliceResult = {
  ok: boolean;
  sliceId: string;
  status: "in-progress" | "missing" | "done" | "blocked" | "conflict";
  agent: string;
  startedAt?: string;
  planSummary?: string;
  sourcePaths?: string[];
  dependencies?: Array<{ id: string; status: string }>;
  conflicts?: ClaimConflict[];
  blocking?: string[];
  error?: string;
  _autoStartedPrd?: string;
  _autoStartedFeature?: string;
};

export async function startSliceCore(
  project: string,
  sliceId: string,
  agent: string,
  repo?: string,
): Promise<StartSliceResult> {
  let hub;
  let plan;
  try {
    hub = await readSliceHub(project, sliceId);
    plan = await readSlicePlan(project, sliceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      sliceId,
      status: "missing",
      agent,
      error: message.includes("not found") ? `slice not found: ${sliceId}` : message,
    };
  }

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) {
    return {
      ok: false,
      sliceId,
      status: "missing",
      agent,
      error: `slice not found in backlog: ${sliceId}`,
    };
  }
  if (context.canonicalCompletion || hasCanonicalSliceCompletionEvidence(hub.data)) {
    return {
      ok: false,
      sliceId,
      status: "done",
      agent,
      error: `${sliceId} is already done`,
    };
  }

  const [dependencies, sourcePaths] = await Promise.all([
    collectDependencyStatuses(project, sliceId),
    readSliceSourcePaths(project, sliceId),
  ]);
  const blocking = dependencies.filter((dependency) => !dependency.done);
  const claim = await collectClaimResult(project, sliceId, agent, repo, context, sourcePaths);
  const startedAt = nowIso();
  const planSummary = summarizePlan(hub.content, plan.content, sourcePaths);

  if (blocking.length > 0) {
    return {
      ok: false,
      sliceId,
      status: "blocked",
      agent,
      startedAt,
      planSummary,
      sourcePaths,
      dependencies: dependencies.map((d) => ({ id: d.id, status: d.status })),
      conflicts: claim.conflicts,
      blocking: blocking.map((d) => d.id),
      error: `${sliceId} is blocked by unfinished dependencies: ${blocking.map((d) => d.id).join(", ")}`,
    };
  }
  if (claim.conflicts.length > 0) {
    return {
      ok: false,
      sliceId,
      status: "conflict",
      agent,
      startedAt,
      planSummary,
      sourcePaths,
      dependencies: dependencies.map((d) => ({ id: d.id, status: d.status })),
      conflicts: claim.conflicts,
      error: formatClaimConflictError(sliceId, claim.conflicts, project, repo),
    };
  }

  await moveTaskToSection(project, sliceId, "In Progress");
  await writeClaimMetadata(project, sliceId, agent, startedAt, sourcePaths);
  await markSliceStarted(project, sliceId, startedAt);
  appendLogEntry("start-slice", sliceId, { project, details: [`agent=${agent}`, `started_at=${startedAt}`] });

  const parentPrd = typeof hub.data.parent_prd === "string" ? hub.data.parent_prd : null;
  const parentFeature = typeof hub.data.parent_feature === "string" ? hub.data.parent_feature : null;
  let autoStartedPrd: string | undefined;
  let autoStartedFeature: string | undefined;
  if (parentPrd) {
    try {
      await lifecycleOpen(project, parentPrd, "prd");
      autoStartedPrd = parentPrd;
    } catch { /* non-fatal */ }
  }
  if (parentFeature) {
    try {
      await lifecycleOpen(project, parentFeature, "feature");
      autoStartedFeature = parentFeature;
    } catch { /* non-fatal */ }
  }

  return {
    ok: true,
    sliceId,
    status: "in-progress",
    agent,
    startedAt,
    planSummary,
    sourcePaths,
    dependencies: dependencies.map((d) => ({ id: d.id, status: d.status })),
    conflicts: claim.conflicts,
    _autoStartedPrd: autoStartedPrd,
    _autoStartedFeature: autoStartedFeature,
  };
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

  const coreResult = await startSliceCore(project, sliceId, agent, repo);

  if (!coreResult.ok) {
    switch (coreResult.status) {
      case "missing": {
        if (json) console.log(JSON.stringify({ project, sliceId, status: "missing", agent }, null, 2));
        fail(coreResult.error ?? `slice not found: ${sliceId}`, 3);
        break;
      }
      case "done": {
        fail(coreResult.error ?? `${sliceId} is already done`, 1);
        break;
      }
      case "blocked": {
        if (json) {
          const jsonResult = {
            sliceId: coreResult.sliceId,
            status: coreResult.status,
            agent: coreResult.agent,
            startedAt: coreResult.startedAt,
            dependencies: coreResult.dependencies,
            claimedPaths: coreResult.sourcePaths,
            planSummary: coreResult.planSummary,
            conflicts: coreResult.conflicts,
          };
          console.log(JSON.stringify(jsonResult, null, 2));
        }
        fail(coreResult.error ?? `${sliceId} is blocked`, 1);
        break;
      }
      case "conflict": {
        if (json) {
          const jsonResult = {
            sliceId: coreResult.sliceId,
            status: coreResult.status,
            agent: coreResult.agent,
            startedAt: coreResult.startedAt,
            dependencies: coreResult.dependencies,
            claimedPaths: coreResult.sourcePaths,
            planSummary: coreResult.planSummary,
            conflicts: coreResult.conflicts,
          };
          console.log(JSON.stringify(jsonResult, null, 2));
        }
        fail(coreResult.error ?? `claim conflict for ${sliceId}`, 2);
        break;
      }
    }
    return;
  }

  // Emit stderr auto-start messages (side effects that must not be in core)
  if (coreResult._autoStartedPrd) {
    process.stderr.write(`auto-started prd ${coreResult._autoStartedPrd}\n`);
  }
  if (coreResult._autoStartedFeature) {
    process.stderr.write(`auto-started feature ${coreResult._autoStartedFeature}\n`);
  }

  const successJsonResult = {
    sliceId: coreResult.sliceId,
    status: coreResult.status,
    agent: coreResult.agent,
    startedAt: coreResult.startedAt,
    dependencies: coreResult.dependencies,
    claimedPaths: coreResult.sourcePaths,
    planSummary: coreResult.planSummary,
    conflicts: coreResult.conflicts,
  };

  if (json) {
    console.log(JSON.stringify(successJsonResult, null, 2));
    return;
  }

  const dependencies = coreResult.dependencies ?? [];
  const sourcePaths = coreResult.sourcePaths ?? [];
  let dependencySummary: string;
  if (dependencies.length) {
    dependencySummary = dependencies.map((dependency) => {
      const done = dependency.status === "done";
      const statusLabel = done ? "✓" : `(${dependency.status})`;
      return `${dependency.id} ${statusLabel}`;
    }).join(", ");
  } else {
    dependencySummary = "none";
  }
  console.log(`Started ${sliceId} (assignee: ${agent})`);
  console.log(`Dependencies: ${dependencySummary}`);
  if (sourcePaths.length) {
    console.log(`Claim registered: ${sourcePaths.join(", ")}`);
  } else {
    console.log(`Claim: no source_paths bound — bind with: wiki bind ${project} specs/slices/${sliceId}/index.md <source-file>`);
  }
  console.log("---");
  console.log(coreResult.planSummary);
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
