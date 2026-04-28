import type { AcceptedChangeSet } from "../kernel/changeset";
import type { StartSliceIntent } from "../kernel/intent";
import { acceptKernelIntent, rejectKernelIntent, type KernelResult } from "../kernel/result";
import { sliceHubPath, validateSingleActiveSlice } from "./active-slice-invariant";
import type { ForgeProjectState } from "./types";

export function evaluateStartSliceIntent(intent: StartSliceIntent, state: ForgeProjectState): KernelResult {
  const invariantRejection = validateSingleActiveSlice({
    state,
    attemptedSliceId: intent.payload.sliceId,
  });
  if (invariantRejection) return rejectKernelIntent(intent, invariantRejection);

  return acceptKernelIntent(intent, buildStartSliceChangeSet(intent, state));
}

function buildStartSliceChangeSet(intent: StartSliceIntent, state: ForgeProjectState): AcceptedChangeSet {
  const slicePath = sliceHubPath(state.project, intent.payload.sliceId);
  return {
    kind: "accepted-changeset",
    id: `start-slice:${state.project}:${intent.payload.sliceId}`,
    intentId: intent.id,
    createdAt: intent.context.requestedAt,
    authority: {
      scope: "forge-lifecycle",
      fieldAuthority: "authored",
      actorId: intent.actor.id,
      reason: "StartSlice intent establishes the single active slice claim.",
    },
    targetRecords: [
      {
        kind: "slice",
        project: state.project,
        id: intent.payload.sliceId,
        path: slicePath,
      },
    ],
    operations: [
      {
        kind: "update-record",
        target: {
          kind: "slice",
          project: state.project,
          id: intent.payload.sliceId,
          path: slicePath,
        },
        fields: [
          { name: "status", authority: "authored", value: "in-progress" },
          { name: "claimed_by", authority: "authored", value: intent.payload.agent },
          { name: "claimed_at", authority: "authored", value: intent.context.requestedAt },
        ],
      },
    ],
    affectedFiles: [
      {
        path: slicePath,
        authority: "authored",
        reason: "Slice hub receives active claim metadata after invariant validation.",
      },
    ],
  };
}
