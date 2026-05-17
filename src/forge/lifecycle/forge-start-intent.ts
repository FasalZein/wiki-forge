import type { AcceptedChangeSet } from "../kernel/changeset";
import type { StartSliceIntent } from "../kernel/intent";
import { createKernelRejection } from "../kernel/rejection";
import { acceptKernelIntent, rejectKernelIntent, type KernelResult } from "../kernel/result";
import { sliceHubPath, validateSingleActiveSlice } from "./active-slice-invariant";
import type { ForgeProjectState } from "./types";

export function evaluateStartSliceIntent(intent: StartSliceIntent, state: ForgeProjectState): KernelResult {
  const invariantRejection = validateSingleActiveSlice({
    state,
    attemptedSliceId: intent.payload.sliceId,
  });
  if (invariantRejection) return rejectKernelIntent(intent, invariantRejection);

  const draftRejection = validateSliceReleasedBeforeStart(intent, state);
  if (draftRejection) return rejectKernelIntent(intent, draftRejection);

  return acceptKernelIntent(intent, buildStartSliceChangeSet(intent, state));
}

function validateSliceReleasedBeforeStart(intent: StartSliceIntent, state: ForgeProjectState) {
  if (state.sliceStatuses?.[intent.payload.sliceId] !== "draft") return null;
  const slicePath = sliceHubPath(state.project, intent.payload.sliceId);
  return createKernelRejection({
    code: "DraftSliceNotReleased",
    reason: `Cannot start ${intent.payload.sliceId}; draft slices must be released before work starts.`,
    invariant: "draft-slice-release-before-start",
    affected: {
      records: [{ kind: "slice", project: state.project, id: intent.payload.sliceId, path: slicePath }],
      files: [{ path: slicePath, reason: "Draft slice cannot be claimed until release records it as ready." }],
    },
    recovery: [{
      command: `wiki forge release ${state.project} ${intent.payload.sliceId} --reason "release draft before start"`,
      description: `Release ${intent.payload.sliceId} first, then retry start.`,
      safeToRetry: true,
    }],
    metadata: {
      project: state.project,
      sliceId: intent.payload.sliceId,
      currentStatus: "draft",
    },
  });
}

function buildStartSliceChangeSet(intent: StartSliceIntent, state: ForgeProjectState): AcceptedChangeSet {
  const slicePath = sliceHubPath(state.project, intent.payload.sliceId);
  return {
    kind: "accepted-changeset",
    id: `forge-start:${state.project}:${intent.payload.sliceId}`,
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
