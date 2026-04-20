import type { PipelineResult } from "../lib/pipeline";
import { renderSteeringPacket, type ForgeSteeringPacket } from "../lib/forge-steering";
import type { ForgeTriage } from "../lib/forge-triage";
import { collectForgeStatus } from "../protocol";
import type { ForgeReview } from "./forge-docs";

export type ResolvedForgeWorkflow = Awaited<ReturnType<typeof collectForgeStatus>> & {
  triage: ForgeTriage;
  steering: ForgeSteeringPacket;
};

export function renderForgePipeline(
  action: "check" | "close",
  workflow: ResolvedForgeWorkflow,
  result: PipelineResult,
  review?: ForgeReview | null,
) {
  console.log(`forge ${action} ${workflow.project}/${workflow.sliceId}: ${result.ok ? "PASS" : "FAIL"}`);
  for (const line of renderSteeringPacket(workflow.steering)) console.log(`- ${line}`);
  console.log(`- active slice: ${workflow.activeSlice ?? "none"}`);
  console.log(`- workflow next phase: ${workflow.workflow.validation.nextPhase ?? "complete"}`);
  console.log(`- next action: ${workflow.triage.command}`);
  for (const step of result.steps) {
    let status = "FAILED";
    if (step.skipped) status = "skipped";
    else if (step.ok) status = "ok";
    const duration = step.durationMs !== null ? ` (${step.durationMs}ms)` : "";
    console.log(`- ${step.id}: ${status}${duration}`);
    if (!step.ok) {
      if (step.stdout) {
        for (const line of step.stdout.split("\n")) console.log(`  ${line}`);
      }
      if (step.stderr && step.stderr !== step.error) {
        for (const line of step.stderr.split("\n")) console.log(`  stderr: ${line}`);
      } else if (step.error) {
        console.log(`  error: ${step.error}`);
      }
      console.log(`  rerun: ${step.rerunCommand}`);
      console.log(`  upstream mutated: ${step.upstreamMutated ? "yes" : "no"}`);
    }
  }
  if (review) {
    if (review.blockers.length) console.log(`- slice-local blockers: ${review.blockers.length}`);
    for (const finding of review.findings) {
      console.log(`- [${finding.scope}][${finding.severity}] ${finding.message}`);
    }
  }
}

export function renderForgeStatus(workflow: ResolvedForgeWorkflow) {
  console.log(`forge status for ${workflow.project}/${workflow.sliceId}`);
  for (const line of renderSteeringPacket(workflow.steering)) console.log(`- ${line}`);
  console.log(`- active slice: ${workflow.activeSlice ?? "none"}`);
  console.log(`- recommended slice: ${workflow.recommendedSlice ?? "none"}`);
  console.log(`- parent prd: ${workflow.parentPrd ?? "none"}`);
  console.log(`- parent feature: ${workflow.parentFeature ?? "none"}`);
  console.log(`- plan: ${workflow.planStatus}`);
  console.log(`- test-plan: ${workflow.testPlanStatus}`);
  console.log(`- verification level: ${workflow.verificationLevel ?? "none"}`);
  console.log(`- workflow next phase: ${workflow.workflow.validation.nextPhase ?? "complete"}`);
  const nextPhaseStatus = workflow.workflow.validation.statuses.find((status) => status.phase === workflow.workflow.validation.nextPhase);
  if (nextPhaseStatus?.missing.length) {
    console.log(`  unmet: ${nextPhaseStatus.missing.join(", ")}`);
  }
  console.log(`- next action: ${workflow.triage.command}`);
  console.log(`  reason: ${workflow.triage.reason}`);
  for (const status of workflow.workflow.validation.statuses) {
    let state = `blocked by ${status.blockedBy.join(", ")}`;
    if (status.completed) state = "done";
    else if (status.ready) state = "ready";
    console.log(`  - ${status.phase}: ${state}${status.missing.length ? ` | unmet ${status.missing.join(", ")}` : ""}`);
  }
}

export function classifyStepFailure(stepId: string, error: string | null): string {
  if (!error) return "Check pipeline output for details";
  switch (stepId) {
    case "checkpoint": return "Update stale wiki pages related to this slice";
    case "lint-repo": return "Move disallowed repo markdown files to wiki vault";
    case "maintain": return "Run wiki maintain manually for diagnostics";
    case "verify-slice": return `Fix failing verification commands: ${error}`;
    case "closeout": return "Update impacted wiki pages and re-verify";
    case "gate": return "Add tests for changed code files or add test_exemptions";
    case "close-slice": return error;
    default: return error;
  }
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
