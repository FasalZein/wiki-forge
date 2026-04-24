import { buildForgeSteering, renderSteeringPacket, type ForgeSteeringPacket, type ForgeTriage } from "../../protocol/steering/index";
import { collectForgeStatus } from "../../protocol";
import type { PipelineResult } from "../pipeline";
import type { ForgeReview } from "./docs";
import { printLine } from "../../lib/cli-output";

export type ResolvedForgeWorkflow = Awaited<ReturnType<typeof collectForgeStatus>> & {
  triage: ForgeTriage;
  steering: ForgeSteeringPacket;
};

export type ForgeStatusWithoutSlice = {
  project: string;
  sliceId: null;
  activeSlice: string | null;
  recommendedSlice: string | null;
  triage: ForgeTriage;
  steering: ForgeSteeringPacket;
};

type PipelineStepResult = PipelineResult["steps"][number];

export function renderForgePipeline(
  action: "check" | "close",
  workflow: ResolvedForgeWorkflow,
  result: PipelineResult,
  review?: ForgeReview | null,
) {
  const resolvedWorkflow = applyPipelineFailureRecovery(workflow, result);
  printLine(`forge ${action} ${workflow.project}/${workflow.sliceId}: ${result.ok ? "PASS" : "FAIL"}`);
  for (const line of renderSteeringPacket(resolvedWorkflow.steering)) printLine(`- ${line}`);
  printLine(`- active slice: ${resolvedWorkflow.activeSlice ?? "none"}`);
  printLine(`- workflow next phase: ${resolvedWorkflow.workflow.validation.nextPhase ?? "complete"}`);
  printLine(`- next action: ${resolvedWorkflow.triage.command}`);
  for (const step of result.steps) {
    let status = "FAILED";
    if (step.skipped) status = "skipped";
    else if (step.ok) status = "ok";
    const duration = step.durationMs !== null ? ` (${step.durationMs}ms)` : "";
    printLine(`- ${step.id}: ${status}${duration}`);
    if (!step.ok) {
      if (step.stdout) {
        for (const line of step.stdout.split("\n")) printLine(`  ${line}`);
      }
      if (step.stderr && step.stderr !== step.error) {
        for (const line of step.stderr.split("\n")) printLine(`  stderr: ${line}`);
      } else if (step.error) {
        printLine(`  error: ${step.error}`);
      }
      printLine(`  rerun: ${step.rerunCommand}`);
      printLine(`  upstream mutated: ${step.upstreamMutated ? "yes" : "no"}`);
    }
  }
  if (review) {
    if (review.blockers.length) printLine(`- slice-local blockers: ${review.blockers.length}`);
    for (const finding of review.findings) {
      printLine(`- [${finding.scope}][${finding.severity}] ${finding.message}`);
    }
  }
}

export function renderForgeStatus(workflow: ResolvedForgeWorkflow) {
  printLine(`forge status for ${workflow.project}/${workflow.sliceId}`);
  for (const line of renderSteeringPacket(workflow.steering)) printLine(`- ${line}`);
  printLine(`- active slice: ${workflow.activeSlice ?? "none"}`);
  printLine(`- recommended slice: ${workflow.recommendedSlice ?? "none"}`);
  printLine(`- parent prd: ${workflow.parentPrd ?? "none"}`);
  printLine(`- parent feature: ${workflow.parentFeature ?? "none"}`);
  printLine(`- plan: ${workflow.planStatus}`);
  printLine(`- test-plan: ${workflow.testPlanStatus}`);
  printLine(`- verification level: ${workflow.verificationLevel ?? "none"}`);
  printLine(`- workflow next phase: ${workflow.workflow.validation.nextPhase ?? "complete"}`);
  const nextPhaseStatus = workflow.workflow.validation.statuses.find((status) => status.phase === workflow.workflow.validation.nextPhase);
  if (nextPhaseStatus?.missing.length) {
    printLine(`  unmet: ${nextPhaseStatus.missing.join(", ")}`);
  }
  printLine(`- next action: ${workflow.triage.command}`);
  printLine(`  reason: ${workflow.triage.reason}`);
  for (const status of workflow.workflow.validation.statuses) {
    let state = `blocked by ${status.blockedBy.join(", ")}`;
    if (status.completed) state = "done";
    else if (status.ready) state = "ready";
    printLine(`  - ${status.phase}: ${state}${status.missing.length ? ` | unmet ${status.missing.join(", ")}` : ""}`);
  }
}

export function renderForgeStatusWithoutSlice(status: ForgeStatusWithoutSlice) {
  printLine(`forge status for ${status.project}`);
  for (const line of renderSteeringPacket(status.steering)) printLine(`- ${line}`);
  printLine(`- active slice: ${status.activeSlice ?? "none"}`);
  printLine(`- recommended slice: ${status.recommendedSlice ?? "none"}`);
  printLine(`- next action: ${status.triage.command}`);
  printLine(`  reason: ${status.triage.reason}`);
}

export function resolveFailedPipelineStep(result: PipelineResult): PipelineStepResult | undefined {
  return result.steps.find((step) => step.id === result.stoppedAt);
}

export function classifyStepFailure(step: PipelineStepResult | undefined): string {
  if (!step) return "Check pipeline output for details";
  return step.rerunCommand || step.error || "Check pipeline output for details";
}

export function applyPipelineFailureRecovery(
  workflow: ResolvedForgeWorkflow,
  result: PipelineResult,
): ResolvedForgeWorkflow {
  if (result.ok) return workflow;
  const failedStep = resolveFailedPipelineStep(result);
  if (!failedStep) return workflow;
  const triage: ForgeTriage = {
    kind: "resume-failed-forge",
    reason: `${result.phase} failed at ${failedStep.id}`,
    command: classifyStepFailure(failedStep),
  };
  return {
    ...workflow,
    triage,
    steering: buildForgeSteering({
      project: workflow.project,
      sliceId: workflow.sliceId,
      triage,
      nextPhase: workflow.workflow.validation.nextPhase ?? null,
      planStatus: workflow.planStatus,
      testPlanStatus: workflow.testPlanStatus,
      verificationLevel: workflow.verificationLevel,
      sliceStatus: workflow.context?.sliceStatus ?? null,
      section: workflow.context?.section ?? null,
      canonicalCompletion: workflow.context?.canonicalCompletion ?? false,
      designPressure: workflow.designPressure,
    }),
  };
}

export function applyResolvedSteering(
  workflow: Awaited<ReturnType<typeof collectForgeStatus>>,
  triage: ForgeTriage,
  steering: ForgeSteeringPacket,
): ResolvedForgeWorkflow {
  return {
    ...workflow,
    triage,
    steering,
  };
}
