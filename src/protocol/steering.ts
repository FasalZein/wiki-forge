import { buildForgeSteering } from "../lib/forge-steering";
import { type ForgePhase } from "../lib/forge-ledger";
import { phaseRecommendation } from "../lib/forge-phase-commands";
import { type ForgeTriage } from "../lib/forge-triage";
import type { BacklogFocus, BacklogTaskContext } from "../hierarchy";
import { collectForgeStatus } from "./forge-status";

type SteeringTaskRef =
  | ({ id: string } & Partial<Pick<BacklogTaskContext, "planStatus" | "testPlanStatus" | "sliceStatus" | "section">>)
  | null
  | undefined;

type WorkflowFocus = Pick<BacklogFocus, "activeTask" | "recommendedTask" | "warnings">;

type FailedForgeHandoff = {
  lastForgeRun?: string;
  lastForgeStep?: string;
  lastForgeOk?: boolean;
  nextAction?: string;
  failureSummary?: string;
} | null | undefined;

type WorkflowSteeringTriageContext = {
  project: string;
  repo: string;
  base: string | undefined;
  activeTask: SteeringTaskRef;
  nextTask: SteeringTaskRef;
  targetTask?: SteeringTaskRef;
  handoff?: FailedForgeHandoff;
  workflowNextPhase?: ForgePhase | null;
  verificationLevel?: string | null;
  targetSliceStatus?: string | null;
  targetSection?: string | null;
};

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

export function classifyWorkflowSteeringTriage(context: WorkflowSteeringTriageContext): ForgeTriage {
  const selectedTask = context.targetTask ?? context.activeTask ?? context.nextTask;
  const verifyCloseSteps = new Set(["verify-slice", "closeout", "gate", "close-slice"]);
  const targetTaskId = context.targetTask?.id ?? null;

  if (context.activeTask && context.handoff?.lastForgeOk === false && context.handoff.nextAction) {
    if (
      (!context.workflowNextPhase || context.workflowNextPhase === "verify")
      && (
      (!targetTaskId || context.activeTask.id === targetTaskId)
      && (context.verificationLevel === "test-verified" || verifyCloseSteps.has(context.handoff.lastForgeStep ?? ""))
      )
    ) {
      return {
        kind: "resume-failed-forge",
        reason: context.handoff.failureSummary ?? `forge run failed at ${context.handoff.lastForgeStep}`,
        command: `wiki forge run ${context.project} ${context.activeTask.id} --repo ${context.repo}${context.base ? ` --base ${context.base}` : ""}`,
      };
    }
  }

  if (selectedTask && context.workflowNextPhase && context.workflowNextPhase !== "verify") {
    return phaseRecommendation(context.project, selectedTask.id, context.workflowNextPhase, context.repo);
  }

  if (targetTaskId && (context.targetSliceStatus === "done" || context.targetSection === "Done")) {
    return {
      kind: "completed",
      reason: "slice is done",
      command: `wiki forge next ${context.project}`,
    };
  }

  if (targetTaskId) {
    if (context.verificationLevel !== "test-verified") {
      return {
        kind: "close-slice",
        reason: `verification level is ${context.verificationLevel ?? "missing"}`,
        command: `wiki forge run ${context.project} ${targetTaskId} --repo ${context.repo}${context.base ? ` --base ${context.base}` : ""}`,
      };
    }

    if (context.activeTask?.id === targetTaskId) {
      return {
        kind: "close-slice",
        reason: "slice is test-verified; close it",
        command: `wiki forge run ${context.project} ${targetTaskId} --repo ${context.repo}${context.base ? ` --base ${context.base}` : ""}`,
      };
    }

    return {
      kind: "open-slice",
      reason: `slice ${targetTaskId} is not the active slice`,
      command: `wiki forge run ${context.project} ${targetTaskId} --repo ${context.repo}${context.base ? ` --base ${context.base}` : ""}`,
    };
  }

  if (context.activeTask) {
    return {
      kind: "continue-active-slice",
      reason: `active slice ${context.activeTask.id} is the current focus`,
      command: `wiki forge run ${context.project} ${context.activeTask.id} --repo ${context.repo}${context.base ? ` --base ${context.base}` : ""}`,
    };
  }

  if (context.nextTask) {
    return {
      kind: "start-next-slice",
      reason: `no slice is active; ${context.nextTask.id} is the next queued slice`,
      command: `wiki forge run ${context.project} ${context.nextTask.id} --repo ${context.repo}${context.base ? ` --base ${context.base}` : ""}`,
    };
  }

  return {
    kind: "plan-next",
    reason: "no active or ready slice was found",
    command: `wiki forge next ${context.project}`,
  };
}

function pickTargetTask(focus: WorkflowFocus, sliceId: string): SteeringTaskRef {
  if (focus.activeTask?.id === sliceId) return focus.activeTask;
  if (focus.recommendedTask?.id === sliceId) return focus.recommendedTask;
  return null;
}
