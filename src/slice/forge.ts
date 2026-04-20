import { relative } from "node:path";
import { nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { defaultAgentName, readFlagValue } from "../lib/cli-utils";
import { exists, readText } from "../lib/fs";
import { runPipeline } from "../lib/pipeline";
import { type ForgeWorkflowLedger } from "../lib/forge-ledger";
import { renderSteeringPacket } from "../lib/forge-steering";
import { projectTaskHubPath } from "../lib/structure";
import { collectBacklogFocus, collectTaskContextForId, createFeatureReturningId, createPrdReturningId, moveTaskToSection } from "../hierarchy";
import { appendLogEntry } from "../lib/log";
import { collectForgeStatus, compactForgeStatusForJson } from "../protocol";
import { resolveTargetWorkflowSteering, resolveWorkflowSteering } from "../protocol/steering";
import { createIssueSlice } from "./slice-scaffold";
import { startSlice, startSliceCore } from "./start";
import { writeSliceProgress, type SlicePipelineProgress, type PipelineStepProgress } from "../lib/slice-progress";
import { parseForgeArgs } from "./forge-args";
import { autoFillSliceDocs, buildSlicePromptData, forgeNextAll, renderSlicePrompt } from "./forge-planning";
import { applyResolvedSteering, classifyStepFailure, renderForgePipeline, renderForgeStatus } from "./forge-output";
import { collectForgeReview } from "./forge-docs";

export async function forgeStart(args: string[]) {
  const parsed = await parseForgeArgs(args, "start");
  return startSlice([parsed.project, parsed.sliceId, ...parsed.passthrough]);
}

export async function forgeCheck(args: string[]) {
  const parsed = await parseForgeArgs(args, "check");
  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId, parsed.repo);
  const result = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "close",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
  });
  const review = parsed.dryRun
    ? null
    : await collectForgeReview(parsed.project, parsed.sliceId, parsed.repo, parsed.base, parsed.worktree);
  if (parsed.json) console.log(JSON.stringify({ ...workflow, pipeline: result, ...(review ? { review } : {}) }, null, 2));
  else renderForgePipeline("check", workflow, result, review);
  if (!result.ok) throw new Error(`forge check failed at ${result.stoppedAt}`);
  if (review && !review.ok) throw new Error("forge check found slice-local blockers");
}

export async function forgeClose(args: string[]) {
  const parsed = await parseForgeArgs(args, "close");
  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId, parsed.repo);
  const result = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "verify",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
  });
  if (parsed.json) console.log(JSON.stringify({ ...workflow, pipeline: result }, null, 2));
  else renderForgePipeline("close", workflow, result);
  if (!result.ok) throw new Error(`forge close failed at ${result.stoppedAt}`);
}

export async function forgeStatus(args: string[]) {
  const parsed = await parseForgeArgs(args, "status");
  const focus = await collectBacklogFocus(parsed.project);
  const resolution = await resolveTargetWorkflowSteering(parsed.project, {
    repo: parsed.repo ?? process.cwd(),
    sliceId: parsed.sliceId,
    base: parsed.base,
    focus,
  });
  const workflow = applyResolvedSteering(resolution.workflow, resolution.triage, resolution.steering);
  if (parsed.json) console.log(JSON.stringify(compactForgeStatusForJson(workflow), null, 2));
  else renderForgeStatus(workflow);
}

export async function forgeOpen(args: string[]) {
  return forgeStart(args);
}

export async function forgeRelease(args: string[]) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);

  const indexPath = projectTaskHubPath(project, sliceId);
  if (!await exists(indexPath)) throw new Error(`slice index not found: ${sliceId}`);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!parsed) throw new Error(`could not parse slice index: ${sliceId}`);

  const claimedBy = typeof parsed.data.claimed_by === "string" ? parsed.data.claimed_by.trim() : null;
  if (!claimedBy) {
    console.log(`no active claim on ${sliceId}`);
    return;
  }

  const wasStarted = context.section === "In Progress" || parsed.data.status === "in-progress";

  const data = { ...parsed.data };
  delete data.claimed_by;
  delete data.claimed_at;
  delete data.claim_paths;
  if (wasStarted) {
    delete data.started_at;
    data.status = "todo";
  }
  data.updated = nowIso();
  writeNormalizedPage(indexPath, parsed.content, orderFrontmatter(data, [
    "title", "type", "spec_kind", "project", "source_paths", "task_id",
    "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "started_at", "status",
  ]));

  if (wasStarted) {
    await moveTaskToSection(project, sliceId, "Todo");
  }

  appendLogEntry("release-claim", sliceId, { project, details: [`released_from=${claimedBy}`] });
  console.log(`released claim on ${sliceId} (was owned by ${claimedBy})`);
  if (wasStarted) console.log(`moved ${sliceId} back to Todo`);
}

export async function forgePlan(args: string[]) {
  const parsed = parseForgePlanArgs(args);
  let createdFeatureId: string | undefined;
  let createdPrdId: string | undefined;
  const createdSliceIds: string[] = [];
  let lastStep = "parse";
  try {
    lastStep = "create-feature";
    const featureId = parsed.featureId ?? await (async () => {
      requireValue(parsed.featureName, "feature-name (positional) or --feature FEAT-xxx");
      const { specId } = await createFeatureReturningId(parsed.project, parsed.featureName!);
      console.log(`created feature ${specId}`);
      createdFeatureId = specId;
      return specId;
    })();
    if (!createdFeatureId) createdFeatureId = featureId;
    const prdName = parsed.prdName ?? parsed.featureName;
    requireValue(prdName, "prd-name (--prd-name) or feature-name positional");
    lastStep = "create-prd";
    const { specId: prdId } = await createPrdReturningId(parsed.project, prdName!, featureId);
    console.log(`created prd ${prdId}`);
    createdPrdId = prdId;

    if (parsed.slices.length > 0) {
      // Multi-slice path
      for (let i = 0; i < parsed.slices.length; i += 1) {
        const sliceTitle = parsed.slices[i];
        lastStep = `create-slice-${i + 1}`;
        const sliceArgs = [
          parsed.project,
          sliceTitle,
          "--prd", prdId,
          ...(parsed.agent ? ["--assignee", parsed.agent] : []),
        ];
        const slice = await createIssueSlice(sliceArgs);
        if (!slice) throw new Error(`createIssueSlice did not return a result for slice ${i + 1}`);
        console.log(`created slice ${slice.taskId}`);
        createdSliceIds.push(slice.taskId);

        if (i > 0) {
          const previousSliceId = createdSliceIds[i - 1];
          await patchSliceDependsOn(parsed.project, slice.taskId, previousSliceId);
        }

        if (i === 0) {
          lastStep = "start-slice";
          await startSlice([
            parsed.project,
            slice.taskId,
            ...(parsed.agent ? ["--agent", parsed.agent] : []),
            ...(parsed.repo ? ["--repo", parsed.repo] : []),
          ]);
        }

        lastStep = `autofill-docs-${i + 1}`;
        await autoFillSliceDocs(parsed.project, slice.taskId, prdId);
      }
      const [startedId, ...pendingIds] = createdSliceIds;
      const pendingSummary = pendingIds.length ? `; pending: ${pendingIds.join(", ")}` : "";
      console.log(`started ${startedId}${pendingSummary}`);
    } else {
      // Single-slice path (original behavior)
      lastStep = "create-slice";
      const sliceTitle = parsed.title ?? prdName!;
      const sliceArgs = [
        parsed.project,
        sliceTitle,
        "--prd", prdId,
        ...(parsed.agent ? ["--assignee", parsed.agent] : []),
      ];
      const slice = await createIssueSlice(sliceArgs);
      if (!slice) throw new Error("createIssueSlice did not return a result");
      console.log(`created slice ${slice.taskId}`);
      createdSliceIds.push(slice.taskId);
      lastStep = "start-slice";
      await startSlice([
        parsed.project,
        slice.taskId,
        ...(parsed.agent ? ["--agent", parsed.agent] : []),
        ...(parsed.repo ? ["--repo", parsed.repo] : []),
      ]);
      lastStep = "autofill-docs";
      await autoFillSliceDocs(parsed.project, slice.taskId, prdId);
    }
  } catch (error) {
    const artifacts: string[] = [];
    if (createdFeatureId) artifacts.push(`  feature: ${createdFeatureId}`);
    if (createdPrdId) artifacts.push(`  prd: ${createdPrdId}`);
    for (const sliceId of createdSliceIds) artifacts.push(`  slice: ${sliceId}`);
    if (artifacts.length) {
      console.error(`forge plan failed at ${lastStep}. Already created:\n${artifacts.join("\n")}`);
      if (createdSliceIds.length) console.error(`Use: wiki forge start ${parsed.project} ${createdSliceIds[0]} to retry from start-slice`);
    }
    throw error;
  }
}

async function patchSliceDependsOn(project: string, sliceId: string, dependsOnSliceId: string): Promise<void> {
  const indexPath = projectTaskHubPath(project, sliceId);
  const raw = await readText(indexPath);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), raw, { silent: true });
  if (!parsed) return;
  const updatedData = orderFrontmatter(
    { ...parsed.data, depends_on: [dependsOnSliceId], updated: nowIso() },
    ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"],
  );
  writeNormalizedPage(indexPath, parsed.content, updatedData);
}

type ForgePlanArgs = {
  project: string;
  featureName: string | undefined;
  featureId: string | undefined;
  prdName: string | undefined;
  title: string | undefined;
  slices: string[];
  agent: string | undefined;
  repo: string | undefined;
};

function parseForgePlanArgs(args: string[]): ForgePlanArgs {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let prdName: string | undefined;
  let title: string | undefined;
  let slices: string[] = [];
  let agent: string | undefined;
  let repo: string | undefined;
  const nameParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--feature":
        featureId = args[index + 1];
        index += 1;
        break;
      case "--prd-name":
        prdName = args[index + 1];
        index += 1;
        break;
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--slices": {
        const raw = args[index + 1] ?? "";
        slices = raw.split(",").map((s) => s.trim()).filter(Boolean);
        index += 1;
        break;
      }
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--repo":
        repo = args[index + 1];
        index += 1;
        break;
      default:
        if (!arg.startsWith("--")) nameParts.push(arg);
        break;
    }
  }
  const featureName = nameParts.join(" ").trim() || undefined;
  if (!featureId && !featureName) throw new Error("feature-name (positional) or --feature FEAT-xxx is required");
  return { project, featureName, featureId, prdName, title, slices, agent, repo };
}

export async function forgeNext(args: string[]) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const promptFlag = args.includes("--prompt");
  const promptJson = args.includes("--prompt-json");
  const all = args.includes("--all");
  const repo = readFlagValue(args, "--repo");

  if (all && !promptJson) {
    throw new Error("--all requires --prompt-json");
  }

  if (all && promptJson) {
    await forgeNextAll(project);
    return;
  }

  const focus = await collectBacklogFocus(project);
  const steeringResolution = await resolveWorkflowSteering(project, {
    repo: repo ?? process.cwd(),
    focus,
  });

  const activeId = steeringResolution.focus.activeTask?.id ?? null;
  const targetId = steeringResolution.focusTask?.id ?? null;

  if (!targetId) {
    if (json || promptJson) console.log(JSON.stringify({ project, targetSlice: null, action: "no ready slices" }, null, 2));
    else console.log(`no ready slices for ${project}`);
    return;
  }

  const workflow = steeringResolution.workflow ?? await collectForgeStatus(project, targetId, repo);

  if (promptJson || promptFlag) {
    const promptData = await buildSlicePromptData(project, targetId, workflow, activeId !== null);
    if (promptJson) {
      console.log(JSON.stringify(promptData, null, 2));
    } else {
      console.log(renderSlicePrompt(promptData));
    }
    return;
  }

  const result = {
    project,
    targetSlice: targetId,
    active: activeId !== null,
    triage: steeringResolution.triage,
    steering: steeringResolution.steering,
    planStatus: steeringResolution.focusTask?.planStatus ?? workflow.planStatus,
    testPlanStatus: steeringResolution.focusTask?.testPlanStatus ?? workflow.testPlanStatus,
    verificationLevel: steeringResolution.verificationLevel ?? workflow.verificationLevel,
  };

  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`forge next for ${project}: ${targetId}`);
    for (const line of renderSteeringPacket(steeringResolution.steering)) console.log(`- ${line}`);
    console.log(`- ${activeId ? "active" : "recommended"} slice`);
    console.log(`- plan: ${result.planStatus}`);
    console.log(`- test-plan: ${result.testPlanStatus}`);
    console.log(`- verification: ${result.verificationLevel ?? "none"}`);
    console.log(`- next action: ${steeringResolution.triage.command}`);
    console.log(`  reason: ${steeringResolution.triage.reason}`);
  }
}

export async function forgeRun(args: string[]) {
  const parsed = await parseForgeArgs(args, "run");

  const focus = await collectBacklogFocus(parsed.project);
  const preResolution = await resolveTargetWorkflowSteering(parsed.project, {
    repo: parsed.repo ?? process.cwd(),
    sliceId: parsed.sliceId,
    base: parsed.base,
    focus,
  });
  const preWorkflow = applyResolvedSteering(preResolution.workflow, preResolution.triage, preResolution.steering);
  const expectedPrefix = `wiki forge run ${parsed.project} ${parsed.sliceId}`;
  const canRunCurrentSlice = preWorkflow.steering.nextCommand.startsWith(expectedPrefix);
  if (!canRunCurrentSlice) {
    const payload = {
      ok: false,
      step: "operator-lane",
      steering: preWorkflow.steering,
      recovery: [
        `wiki forge release ${parsed.project} ${parsed.sliceId}`,
        `wiki close-slice ${parsed.project} ${parsed.sliceId} --reason "<reason>"`,
      ],
    };
    if (parsed.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`forge run blocked for ${parsed.sliceId}`);
      for (const line of renderSteeringPacket(preWorkflow.steering)) console.log(`- ${line}`);
      console.log(`  recovery: ${payload.recovery.join("  |  ")}`);
    }
    throw new Error(`operator-lane: ${parsed.sliceId} is in ${preWorkflow.steering.lane}; run \`${preWorkflow.steering.nextCommand}\` first`);
  }

  const context = await collectTaskContextForId(parsed.project, parsed.sliceId);
  if (!context || context.section !== "In Progress") {
    const startResult = await startSliceCore(parsed.project, parsed.sliceId, defaultAgentName(), parsed.repo);
    if (!startResult.ok) {
      const errorPayload = {
        ok: false,
        step: "auto-start",
        error: startResult.error ?? "start failed",
        status: startResult.status,
        ...(startResult.conflicts?.length ? { conflicts: startResult.conflicts } : {}),
        ...(startResult.blocking?.length ? { blocking: startResult.blocking } : {}),
      };
      if (parsed.json) console.log(JSON.stringify(errorPayload, null, 2));
      throw new Error(`forge run: auto-start failed: ${startResult.error}`);
    }
    if (!parsed.json) console.log(`auto-started ${parsed.sliceId} (agent: ${startResult.agent})`);
  }

  const activeFocus = await collectBacklogFocus(parsed.project);
  const workflowResolution = await resolveTargetWorkflowSteering(parsed.project, {
    repo: parsed.repo ?? process.cwd(),
    sliceId: parsed.sliceId,
    base: parsed.base,
    focus: activeFocus,
  });
  const workflow = applyResolvedSteering(workflowResolution.workflow, workflowResolution.triage, workflowResolution.steering);

  const progressSteps: PipelineStepProgress[] = [];
  const onStepComplete = async (step: {
    id: string;
    label: string;
    ok: boolean;
    error: string | null;
    durationMs: number | null;
    rerunCommand: string;
    upstreamMutated: boolean;
  }) => {
    progressSteps.push({
      id: step.id,
      ok: step.ok,
      completedAt: new Date().toISOString(),
      durationMs: step.durationMs,
      ...(step.error ? { error: step.error } : {}),
    });
  };

  const writeProgress = async (pipelineOk: boolean, nextAction?: string, failureSummary?: string) => {
    const progress: SlicePipelineProgress = {
      steps: progressSteps,
      lastStep: progressSteps[progressSteps.length - 1]?.id ?? "none",
      lastStepOk: progressSteps[progressSteps.length - 1]?.ok ?? false,
      pipelineOk,
      lastRunAt: new Date().toISOString(),
      ...(nextAction ? { nextAction } : {}),
      ...(failureSummary ? { failureSummary } : {}),
    };
    await writeSliceProgress(parsed.project, parsed.sliceId, progress);
  };

  const checkResult = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "close",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
    onStepComplete,
  });
  const review = parsed.dryRun
    ? null
    : await collectForgeReview(parsed.project, parsed.sliceId, parsed.repo, parsed.base, parsed.worktree);
  if (!parsed.json) renderForgePipeline("check", workflow, checkResult, review);
  if (!checkResult.ok) {
    const failedStep = checkResult.stoppedAt ?? "unknown";
    const failedStepError = checkResult.steps.find((s) => s.id === failedStep)?.error ?? null;
    const nextAction = classifyStepFailure(failedStep, failedStepError);
    await writeProgress(false, nextAction, `check failed at ${failedStep}`);
    throw new Error(`forge run: check failed at ${failedStep}`);
  }
  if (review && !review.ok) {
    await writeProgress(false, "Resolve slice-local blockers reported by forge check", "check found slice-local blockers");
    throw new Error("forge run: check found slice-local blockers");
  }

  const closeResult = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "verify",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
    upstreamMutatedBeforeStart: true,
    onStepComplete,
  });
  if (parsed.json) console.log(JSON.stringify({ ...workflow, check: checkResult, close: closeResult }, null, 2));
  else renderForgePipeline("close", workflow, closeResult);
  if (!closeResult.ok) {
    const failedStep = closeResult.stoppedAt ?? "unknown";
    const failedStepError = closeResult.steps.find((s) => s.id === failedStep)?.error ?? null;
    const nextAction = classifyStepFailure(failedStep, failedStepError);
    await writeProgress(false, nextAction, `close failed at ${failedStep}`);
    throw new Error(`forge run: close failed at ${failedStep}`);
  }

  await writeProgress(true);
}
