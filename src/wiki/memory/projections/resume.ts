import type { ForgeNextProjection } from "../../../forge/workflow/status-projection";

export type ResumeProjection = {
  readonly kind: "resume-projection";
  readonly project: string;
  readonly mutatesLifecycle: false;
  readonly authoritativeStatusSource: "canonical-records";
  readonly activeSliceId?: string;
  readonly nextSliceId?: string;
  readonly nextAction: string;
  readonly context: readonly string[];
};

export type BuildResumeProjectionInput = {
  readonly project: string;
  readonly statusTruth: ForgeNextProjection;
  readonly context: readonly string[];
};

export function buildResumeProjection(input: BuildResumeProjectionInput): ResumeProjection {
  return {
    kind: "resume-projection",
    project: input.project,
    mutatesLifecycle: false,
    authoritativeStatusSource: input.statusTruth.source,
    ...statusFields(input.statusTruth),
    context: input.context,
  };
}

function statusFields(statusTruth: ForgeNextProjection): Pick<ResumeProjection, "activeSliceId" | "nextSliceId" | "nextAction"> {
  if (statusTruth.status === "active") {
    return {
      activeSliceId: statusTruth.activeSliceId,
      nextAction: statusTruth.nextAction,
    };
  }
  if (statusTruth.status === "ready") {
    return {
      nextSliceId: statusTruth.nextSliceId,
      nextAction: statusTruth.nextAction,
    };
  }
  if (statusTruth.status === "empty") return { nextAction: statusTruth.nextAction };
  if (statusTruth.status === "conflict") return { nextAction: "recover-conflict" };
  return { nextAction: "repair-canonical-records" };
}
