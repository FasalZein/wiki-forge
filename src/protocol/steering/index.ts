import type { BacklogFocus, BacklogTaskContext } from "../../hierarchy";
import { collectForgeStatus } from "../status";
import {
  classifyWorkflowSteeringTriage,
  type FailedForgeHandoff,
  type WorkflowFocus,
  type SteeringTaskRef,
} from "./triage";
import { type ForgePhase } from "../status/workflow-ledger";
import { buildForgeSteering } from "./packet";
import { type ForgeTriage } from "./triage-types";

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
        canonicalCompletion: focusTask.canonicalCompletion,
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
    targetCanonicalCompletion: targetTask?.canonicalCompletion ?? workflow.context?.canonicalCompletion ?? false,
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
    canonicalCompletion: targetTask?.canonicalCompletion ?? workflow.context?.canonicalCompletion ?? false,
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

export { buildForgeSteering, isMaintenanceRepairCommand, renderSteeringPacket } from "./packet";
export { phaseRecommendation } from "./phase-commands";
export { classifyWorkflowSteeringTriage } from "./triage";
export { PRE_PHASE_TRIAGE_KINDS, isForgeRunTriage, isPrePhaseTriage } from "./triage-types";
export type { ForgeLane, ForgeSteeringPacket } from "./packet";
export type { PhaseRecommendation } from "./phase-commands";
export type { ForgePhase } from "../status/workflow-ledger";
export type {
  FailedForgeHandoff,
  SteeringTaskRef,
  WorkflowFocus,
  WorkflowSteeringTriageContext,
} from "./triage";
export type { ForgeTriage, ForgeTriageKind, PrePhaseTriageKind } from "./triage-types";
