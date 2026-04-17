import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, fail, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { readSliceHub, readSlicePlan, readSliceSourcePaths } from "../lib/slices";
import { projectTaskHubPath } from "../lib/structure";
import { collectTaskContextForId, moveTaskToSection } from "../hierarchy/backlog";
import { lifecycleOpen } from "../commands/hierarchy-commands";
import { summarizePlan } from "../session";
import { collectClaimResult, collectDependencyStatuses, defaultAgentName, writeClaimMetadata } from "./_shared";

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
