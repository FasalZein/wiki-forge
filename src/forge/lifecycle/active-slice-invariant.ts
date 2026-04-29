import type { ChangeTargetRecord } from "../kernel/changeset";
import { createKernelRejection, type KernelRejection } from "../kernel/rejection";
import type { ActiveSliceClaim, ForgeProjectState } from "./types";

export type ActiveSliceInvariantInput = {
  readonly state: ForgeProjectState;
  readonly attemptedSliceId: string;
};

export function validateSingleActiveSlice(input: ActiveSliceInvariantInput): KernelRejection | null {
  const activeSlices = input.state.activeSlices;
  if (activeSlices.length === 0) return null;

  const activeSliceIds = activeSlices.map((claim) => claim.sliceId);
  return createKernelRejection({
    code: activeSlices.length === 1 ? "AnotherSliceActive" : "MultipleActiveSlices",
    reason: activeSlices.length === 1
      ? `Cannot start ${input.attemptedSliceId}; ${activeSliceIds[0]} is already active.`
      : `Cannot start ${input.attemptedSliceId}; multiple slices are already active: ${activeSliceIds.join(", ")}.`,
    invariant: "single-active-slice",
    affected: {
      records: [
        ...activeSlices.map(activeClaimToRecord),
        {
          kind: "slice",
          project: input.state.project,
          id: input.attemptedSliceId,
          path: sliceHubPath(input.state.project, input.attemptedSliceId),
        },
      ],
      files: [
        ...activeSlices.map((claim) => ({
          path: sliceHubPath(claim.project, claim.sliceId),
          reason: "Existing active slice claim blocks the start intent.",
        })),
        {
          path: sliceHubPath(input.state.project, input.attemptedSliceId),
          reason: "Attempted slice cannot be claimed until the active-slice invariant is satisfied.",
        },
      ],
    },
    recovery: buildActiveSliceRecovery(input.state.project, input.attemptedSliceId, activeSliceIds),
    metadata: {
      project: input.state.project,
      attemptedSliceId: input.attemptedSliceId,
      activeSliceIds,
    },
  });
}

export function sliceHubPath(project: string, sliceId: string): string {
  return `projects/${project}/forge/slices/${sliceId}/index.md`;
}

function activeClaimToRecord(claim: ActiveSliceClaim): ChangeTargetRecord {
  return {
    kind: "active-claim",
    project: claim.project,
    id: claim.sliceId,
    path: sliceHubPath(claim.project, claim.sliceId),
  };
}

function buildActiveSliceRecovery(project: string, attemptedSliceId: string, activeSliceIds: readonly string[]) {
  const activeSummary = activeSliceIds.join(", ");
  return [
    {
      command: `wiki forge release ${project} ${activeSummary} --reason "release before starting ${attemptedSliceId}"`,
      description: `Release the currently active slice before starting ${attemptedSliceId}.`,
      safeToRetry: true,
    },
    {
      command: `wiki forge start ${project} ${attemptedSliceId} --takeover --reason "replace active ${activeSummary}"`,
      description: `Take over only after recording why ${activeSummary} is no longer the active work.`,
      safeToRetry: false,
    },
  ];
}
