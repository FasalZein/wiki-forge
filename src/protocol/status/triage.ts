import type { BacklogTaskContext } from "../../hierarchy";
import { classifyWorkflowSteeringTriage } from "../steering/triage";
import { type ForgePhase } from "./workflow-ledger";
import { type ForgeTriage } from "../steering/triage-types";

type TaskDocState = BacklogTaskContext["planStatus"];

export type ForgeTriageInput = {
  activeSlice: string | null;
  sliceStatus: string | null;
  section: string | null;
  canonicalCompletion?: boolean;
  planStatus: string;
  testPlanStatus: string;
  verificationLevel: string | null;
  nextPhase: ForgePhase | null;
  repo?: string;
};

export function buildForgeTriage(project: string, sliceId: string, input: ForgeTriageInput): ForgeTriage {
  return classifyWorkflowSteeringTriage({
    project,
    repo: input.repo ?? "<path>",
    base: undefined,
    activeTask: input.activeSlice ? { id: input.activeSlice } : null,
    nextTask: null,
    targetTask: {
      id: sliceId,
      planStatus: input.planStatus as TaskDocState,
      testPlanStatus: input.testPlanStatus as TaskDocState,
      ...(input.sliceStatus ? { sliceStatus: input.sliceStatus } : {}),
      ...(input.section ? { section: input.section } : {}),
    },
    workflowNextPhase: input.nextPhase,
    verificationLevel: input.verificationLevel,
    targetSliceStatus: input.sliceStatus,
    targetSection: input.section,
    targetCanonicalCompletion: input.canonicalCompletion ?? false,
  });
}
