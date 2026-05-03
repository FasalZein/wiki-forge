import { validateSingleActiveSlice } from "./active-slice-invariant";
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

  return {
    status: "empty",
    project: input.project,
    nextAction: "plan-next-slice",
    reason: "No startable or releasable Forge slice exists.",
    noSafeCommandReason: "No active, ready, or draft Forge slices exist; create or complete a planning session first.",
    source: "canonical-records",
  };
}
