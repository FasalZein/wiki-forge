import { validateSingleActiveSlice } from "./active-slice-invariant";
import { collectLegacyDiagnostics, type ForgeNextInput, type ForgeNextProjection } from "../workflow/status-projection";

export function evaluateForgeNext(input: ForgeNextInput): ForgeNextProjection {
  const diagnostics = collectLegacyDiagnostics(input.legacyClassifications);
  if (diagnostics.length > 0) {
    return {
      status: "needs-repair",
      project: input.project,
      source: "canonical-records",
      diagnostics,
    };
  }

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
      source: "canonical-records",
    };
  }

  return {
    status: "empty",
    project: input.project,
    nextAction: "plan-next-slice",
    source: "canonical-records",
  };
}
