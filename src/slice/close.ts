import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, requireForceAcknowledgement, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { readSliceHub, readSlicePlan, readSliceTestPlan } from "../lib/slices";
import { readVerificationLevel } from "../lib/verification";
import { projectTaskHubPath } from "../lib/structure";
import {
  collectTaskContextForId,
  moveTaskToSection,
  writeProjectIndex,
  computeEntityStatus,
  lifecycleClose,
} from "../hierarchy";
import { collectGate, compactDoctorForJson, collectCloseout, isTestFile } from "../maintenance";
import { resolveDefaultBase } from "../git-utils";
import { applyVerificationLevel } from "../verification";

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
  const sliceLocal = args.includes("--slice-local");
  const forceReview = args.includes("--force-review");
  // --force-review is a narrower bypass for closeout REVIEW PASS only; it is
  // already intentionally explicit, so no second-step is required.
  // --force is the superset bypass; it requires --yes-really-force as a
  // two-step acknowledgement to prevent accidental skips.
  const force = forceReview || requireForceAcknowledgement(args, "close-slice");

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);
  if (!context.hasSliceDocs) throw new Error(`slice docs missing for ${sliceId}`);
  const hub = await readSliceHub(project, sliceId);
  if (context.section !== "In Progress") {
    if (canAutoHealCloseLifecycle(hub.data)) {
      await moveTaskToSection(project, sliceId, "In Progress");
      appendLogEntry("close-slice-autoheal", sliceId, { project, details: [`from=${context.section}`, "to=In Progress"] });
    } else {
      throw new Error(`slice must be In Progress before closeout: ${sliceId} is in ${context.section}`);
    }
  }
  if (context.planStatus !== "ready" || context.testPlanStatus !== "ready") {
    throw new Error(`slice docs are not ready for closeout: plan=${context.planStatus} test-plan=${context.testPlanStatus}`);
  }
  const closeSliceParentPrd = typeof hub.data.parent_prd === "string" ? hub.data.parent_prd : null;
  const closeSliceParentFeature = typeof hub.data.parent_feature === "string" ? hub.data.parent_feature : null;
  const testPlan = await readSliceTestPlan(project, sliceId);
  const testPlanLevel = readVerificationLevel(testPlan.data);
  if (testPlanLevel !== "test-verified") {
    throw new Error(`slice test-plan must be test-verified before closeout: ${sliceId}`);
  }
  if (!hasStructuredVerificationEvidence(testPlan.data)) {
    throw new Error(`slice test-plan is missing structured verification evidence before closeout: ${sliceId}`);
  }

  const closeout = await collectCloseout(project, base, repo, undefined, undefined, { worktree, sliceLocal, sliceId });
  const uncoveredChangedCodeFiles = closeout.refreshFromGit.uncoveredFiles.filter((file) => !isTestFile(file));
  const reviewPassPending = closeout.ok && closeout.staleImpactedPages.length > 0;
  const closeoutBlockers = [
    ...closeout.blockers,
    ...(!worktree && closeout.staleImpactedPages.length ? [`${closeout.staleImpactedPages.length} impacted page(s) are stale or otherwise drifted (closeout: REVIEW PASS — run: ${closeout.nextSteps.join(" && ")})`] : []),
    ...(!sliceLocal && uncoveredChangedCodeFiles.length ? [`${uncoveredChangedCodeFiles.length} changed code file(s) are not covered by wiki bindings`] : []),
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
    const gate = await collectGate(project, base, repo, { worktree, precomputedCloseout: closeout, sliceLocal, sliceId });
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

function canAutoHealCloseLifecycle(data: Record<string, unknown>) {
  const status = typeof data.status === "string" ? data.status : null;
  return status === "in-progress" || status === "done" || typeof data.started_at === "string" || typeof data.completed_at === "string";
}

function hasStructuredVerificationEvidence(data: Record<string, unknown>) {
  return Array.isArray(data.verification_commands) && data.verification_commands.length > 0 && typeof data.verified_against === "string" && data.verified_against.trim().length > 0;
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
