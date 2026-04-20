import { type ForgePhase } from "../lib/forge-ledger";
import { phaseRecommendation } from "../lib/forge-phase-commands";
import { type ForgeTriage } from "../lib/forge-triage";
import type { BacklogFocus, BacklogTaskContext } from "../hierarchy";

export type SteeringTaskRef =
  | ({ id: string } & Partial<Pick<BacklogTaskContext, "planStatus" | "testPlanStatus" | "sliceStatus" | "section">>)
  | null
  | undefined;

export type WorkflowFocus = Pick<BacklogFocus, "activeTask" | "recommendedTask" | "warnings">;

export type FailedForgeHandoff = {
  lastForgeRun?: string;
  lastForgeStep?: string;
  lastForgeOk?: boolean;
  nextAction?: string;
  failureSummary?: string;
} | null | undefined;

export type WorkflowSteeringTriageContext = {
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

export function classifyWorkflowSteeringTriage(context: WorkflowSteeringTriageContext): ForgeTriage {
  const selectedTask = context.targetTask ?? context.activeTask ?? context.nextTask;
  const verifyCloseSteps = new Set(["verify-slice", "closeout", "gate", "close-slice"]);
  const targetTaskId = context.targetTask?.id ?? null;

  if (context.activeTask && context.handoff?.lastForgeOk === false && context.handoff.nextAction) {
    if (
      (!context.workflowNextPhase || context.workflowNextPhase === "verify")
      && (!targetTaskId || context.activeTask.id === targetTaskId)
      && (context.verificationLevel === "test-verified" || verifyCloseSteps.has(context.handoff.lastForgeStep ?? ""))
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
