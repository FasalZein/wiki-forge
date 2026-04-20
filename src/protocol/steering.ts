import { buildForgeSteering } from "../lib/forge-steering";
import { type ForgePhase } from "../lib/forge-ledger";
import { type ForgeTriage } from "../lib/forge-triage";
import type { BacklogFocus, BacklogTaskContext } from "../hierarchy";
import { collectForgeStatus } from "./forge-status";
import {
  classifyWorkflowSteeringTriage,
  type FailedForgeHandoff,
  type WorkflowFocus,
  type SteeringTaskRef,
} from "./steering-triage";

export type WorkflowSteeringResolution = {
  focus: Pick<BacklogFocus, "activeTask" | "recommendedTask" | "warnings">;
  focusTask: BacklogTaskContext | null;
  active: boolean;
  workflow: Awaited<ReturnType<typeof collectForgeStatus>> | null;
  workflowNextPhase: ForgePhase | null;
  verificationLevel: string | null;
  triage: ForgeTriage;
  steering: ReturnType<typeof buildForgeSteering>;
};

export async function resolveWorkflowSteering(
  project: string,
  input: {
    repo: string;
    base?: string;
    focus: WorkflowFocus;
    handoff?: FailedForgeHandoff;
  },
): Promise<WorkflowSteeringResolution> {
  const focusTask = input.focus.activeTask ?? input.focus.recommendedTask;
  const workflow = focusTask ? await collectForgeStatus(project, focusTask.id, input.repo).catch(() => null) : null;
  const workflowNextPhase = workflow?.workflow.validation.nextPhase ?? null;
  const verificationLevel = workflow?.verificationLevel ?? null;
  const triage = classifyWorkflowSteeringTriage({
    project,
    repo: input.repo,
    base: input.base,
    activeTask: input.focus.activeTask,
    nextTask: input.focus.recommendedTask,
    handoff: input.handoff,
    workflowNextPhase,
    verificationLevel,
  });
  const steering = focusTask
    ? buildForgeSteering({
        project,
        sliceId: focusTask.id,
        triage,
        nextPhase: workflowNextPhase,
        planStatus: focusTask.planStatus,
        testPlanStatus: focusTask.testPlanStatus,
        verificationLevel,
        sliceStatus: focusTask.sliceStatus,
        section: focusTask.section,
      })
    : buildForgeSteering({
        project,
        sliceId: null,
        triage,
        nextPhase: null,
      });
  return {
    focus: input.focus,
    focusTask,
    active: Boolean(input.focus.activeTask),
    workflow,
    workflowNextPhase,
    verificationLevel,
    triage,
    steering,
  };
}

export type TargetWorkflowSteeringResolution = {
  focus: WorkflowFocus;
  targetTask: SteeringTaskRef;
  workflow: Awaited<ReturnType<typeof collectForgeStatus>>;
  workflowNextPhase: ForgePhase | null;
  verificationLevel: string | null;
  triage: ForgeTriage;
  steering: ReturnType<typeof buildForgeSteering>;
};

export async function resolveTargetWorkflowSteering(
  project: string,
  input: {
    repo: string;
    sliceId: string;
    base?: string;
    focus: WorkflowFocus;
    handoff?: FailedForgeHandoff;
  },
): Promise<TargetWorkflowSteeringResolution> {
  const workflow = await collectForgeStatus(project, input.sliceId, input.repo);
  const targetTask = workflow.context ?? pickTargetTask(input.focus, input.sliceId);
  const workflowNextPhase = workflow.workflow.validation.nextPhase ?? null;
  const verificationLevel = workflow.verificationLevel ?? null;
  const triage = classifyWorkflowSteeringTriage({
    project,
    repo: input.repo,
    base: input.base,
    activeTask: input.focus.activeTask,
    nextTask: input.focus.recommendedTask,
    targetTask: targetTask ?? { id: input.sliceId },
    handoff: input.handoff,
    workflowNextPhase,
    verificationLevel,
    targetSliceStatus: targetTask?.sliceStatus ?? workflow.context?.sliceStatus ?? null,
    targetSection: targetTask?.section ?? workflow.context?.section ?? null,
  });
  const steering = buildForgeSteering({
    project,
    sliceId: input.sliceId,
    triage,
    nextPhase: workflowNextPhase,
    planStatus: targetTask?.planStatus ?? workflow.planStatus,
    testPlanStatus: targetTask?.testPlanStatus ?? workflow.testPlanStatus,
    verificationLevel,
    sliceStatus: targetTask?.sliceStatus ?? workflow.context?.sliceStatus ?? null,
    section: targetTask?.section ?? workflow.context?.section ?? null,
  });
  return {
    focus: input.focus,
    targetTask,
    workflow,
    workflowNextPhase,
    verificationLevel,
    triage,
    steering,
  };
}

function pickTargetTask(focus: WorkflowFocus, sliceId: string): SteeringTaskRef {
  if (focus.activeTask?.id === sliceId) return focus.activeTask;
  if (focus.recommendedTask?.id === sliceId) return focus.recommendedTask;
  return null;
}
