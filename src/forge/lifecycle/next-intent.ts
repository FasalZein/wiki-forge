import { validateSingleActiveSlice } from "./active-slice-invariant";
import { buildPhaseSkillPacket } from "../workflow/phase-skill-packet";
import type { ForgeNextInput, ForgeNextProjection } from "../workflow/status-projection";

function shellArg(value: string): string {
  if (/^[A-Za-z0-9._:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function evaluateForgeNext(input: ForgeNextInput): ForgeNextProjection {
  const activeSlices = input.slices.filter((slice) => slice.status === "in-progress");
  if (activeSlices.length > 1) {
    const rejection = validateSingleActiveSlice({
      state: {
        project: input.project,
        activeSlices: activeSlices.map((slice) => ({ project: slice.project, sliceId: slice.taskId })),
      },
      attemptedSliceId: "<next-slice>",
    });
    if (rejection) {
      return {
        status: "conflict",
        project: input.project,
        reason: "Multiple active slices violate the single-active-slice invariant.",
        noSafeCommandReason: "Resolve the active-slice conflict before starting or releasing more work.",
        source: "canonical-records",
        rejection,
      };
    }
  }

  const activeSlice = activeSlices[0];
  if (activeSlice) {
    return {
      status: "active",
      project: input.project,
      activeSliceId: activeSlice.taskId,
      nextAction: "continue-active-slice",
      nextCommand: `wiki forge status ${shellArg(input.project)} ${shellArg(activeSlice.taskId)} --json`,
      reason: "Active slice exists; inspect slice status and continue its gates.",
      phasePacket: buildPhaseSkillPacket("implementation", { project: input.project, sliceId: activeSlice.taskId }),
      source: "canonical-records",
    };
  }

  const readySlice = input.slices.find((slice) => slice.status === "ready");
  if (readySlice) {
    return {
      status: "ready",
      project: input.project,
      nextSliceId: readySlice.taskId,
      nextAction: "start-ready-slice",
      nextCommand: `wiki forge start ${shellArg(input.project)} ${shellArg(readySlice.taskId)}`,
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    };
  }

  const draftSlices = input.slices.filter((slice) => slice.status === "draft");
  if (draftSlices.length > 0) {
    const candidates = draftSlices.map((slice) => ({
      sliceId: slice.taskId,
      title: slice.title,
      nextCommand: `wiki forge release ${shellArg(input.project)} ${shellArg(slice.taskId)}`,
    }));
    return {
      status: "drafts",
      project: input.project,
      draftSlices: draftSlices.map((slice) => ({
        sliceId: slice.taskId,
        title: slice.title,
        commands: {
          release: `wiki forge release ${shellArg(input.project)} ${shellArg(slice.taskId)}`,
          startAfterRelease: `wiki forge start ${shellArg(input.project)} ${shellArg(slice.taskId)}`,
        },
      })),
      nextAction: "release-draft-slice",
      nextCommand: candidates[0]?.nextCommand,
      reason: "Draft slices exist but must be released before start.",
      candidates,
      source: "canonical-records",
    };
  }

  const planningSession = input.planningSessions?.find((session) => session.status === "ready-for-artifacts")
    ?? input.planningSessions?.find((session) => session.status === "draft");
  if (planningSession?.status === "ready-for-artifacts") {
    return {
      status: "planning-session",
      project: input.project,
      featureName: planningSession.featureName,
      sessionId: planningSession.sessionId,
      planningStatus: planningSession.status,
      nextAction: "create-planning-artifacts",
      nextCommand: `wiki forge plan ${shellArg(input.project)} ${shellArg(planningSession.featureName)} --create-artifacts`,
      reason: "A Forge planning session is ready to create feature, PRD, and slice artifacts.",
      phasePacket: buildPhaseSkillPacket("plan", { project: input.project, featureName: planningSession.featureName }),
      source: "canonical-records",
    };
  }
  if (planningSession?.status === "draft") {
    return {
      status: "planning-session",
      project: input.project,
      featureName: planningSession.featureName,
      sessionId: planningSession.sessionId,
      planningStatus: planningSession.status,
      nextAction: "continue-planning-session",
      nextCommand: `wiki forge plan ${shellArg(input.project)} ${shellArg(planningSession.featureName)} --json`,
      reason: "A Forge planning session exists and needs completion before artifact creation.",
      phasePacket: buildPhaseSkillPacket("plan", { project: input.project, featureName: planningSession.featureName }),
      source: "canonical-records",
    };
  }

  return {
    status: "empty",
    project: input.project,
    nextAction: "project-complete-or-plan-more-scope",
    reason: "No active, ready, or draft Forge slices exist; current Forge slice set is complete or empty.",
    noSafeCommandReason: "No open Forge slices exist. Stop here unless the user wants more scope; then run wiki forge plan to create the next slice.",
    source: "canonical-records",
  };
}
