import { defaultAgentName } from "../../lib/cli-utils";
import { renderSteeringPacket } from "../../protocol/steering/index";
import { collectBacklogFocus, collectTaskContextForId } from "../../hierarchy";
import { resolveTargetWorkflowSteering } from "../../protocol";
import { writeSliceProgress, type PipelineStepProgress, type SlicePipelineProgress } from "../pipeline";
import { startSliceCore } from "../lifecycle/start";
import { collectForgeReview } from "./docs";
import { parseForgeArgs } from "./args";
import {
  applyPipelineFailureRecovery,
  applyResolvedSteering,
  classifyStepFailure,
  renderForgePipeline,
  resolveFailedPipelineStep,
} from "./output";
import { runPipeline } from "../pipeline";

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
  const { onStepComplete, writeProgress } = createProgressTracker(
    parsed.project,
    parsed.sliceId,
    buildForgeRunCommand(parsed.project, parsed.sliceId, parsed.repo, parsed.base),
  );

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
    if (parsed.json) {
      console.log(JSON.stringify({ ...applyPipelineFailureRecovery(workflow, checkResult), check: checkResult }, null, 2));
    }
    const failedStep = resolveFailedPipelineStep(checkResult);
    const nextAction = classifyStepFailure(failedStep);
    await writeProgress("failed", nextAction, `check failed at ${failedStep?.id ?? "unknown"}`);
    throw new Error(`forge run: check failed at ${failedStep?.id ?? "unknown"}`);
  }
  if (review && !review.ok) {
    await writeProgress("failed", "Resolve slice-local blockers reported by forge check", "check found slice-local blockers");
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
  if (parsed.json) {
    const outputWorkflow = closeResult.ok ? workflow : applyPipelineFailureRecovery(workflow, closeResult);
    console.log(JSON.stringify({ ...outputWorkflow, check: checkResult, close: closeResult }, null, 2));
  }
  else renderForgePipeline("close", workflow, closeResult);
  if (!closeResult.ok) {
    const failedStep = resolveFailedPipelineStep(closeResult);
    const nextAction = classifyStepFailure(failedStep);
    await writeProgress("failed", nextAction, `close failed at ${failedStep?.id ?? "unknown"}`);
    throw new Error(`forge run: close failed at ${failedStep?.id ?? "unknown"}`);
  }

  await writeProgress("passed");
}

function createProgressTracker(project: string, sliceId: string, resumeCommand: string) {
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
    await writeProgress("running", resumeCommand);
  };

  const writeProgress = async (
    pipelineState: SlicePipelineProgress["pipelineState"],
    nextAction?: string,
    failureSummary?: string,
  ) => {
    const terminal = pipelineState === "passed" || pipelineState === "failed";
    const progress: SlicePipelineProgress = {
      steps: progressSteps,
      lastStep: progressSteps[progressSteps.length - 1]?.id ?? "none",
      lastStepOk: progressSteps[progressSteps.length - 1]?.ok ?? false,
      pipelineOk: pipelineState === "passed",
      lastRunAt: new Date().toISOString(),
      ...(pipelineState ? { pipelineState } : {}),
      ...(nextAction ? { nextAction } : {}),
      ...(terminal && failureSummary ? { failureSummary } : {}),
    };
    await writeSliceProgress(project, sliceId, progress);
  };

  return { onStepComplete, writeProgress };
}

function buildForgeRunCommand(project: string, sliceId: string, repo?: string, base?: string) {
  return `wiki forge run ${project} ${sliceId}${repo ? ` --repo ${repo}` : ""}${base ? ` --base ${base}` : ""}`;
}
