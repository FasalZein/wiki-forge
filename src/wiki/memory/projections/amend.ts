import { createAmendmentSliceDraft } from "../../../forge/lifecycle/close-slice-intent";
import type { AmendmentSliceDraft } from "../../../forge/lifecycle/evidence";

export type AmendProjection = {
  readonly kind: "amend-projection";
  readonly mutatesClosedSlice: false;
  readonly followUp: AmendmentSliceDraft;
  readonly closedEvidenceRefs: readonly string[];
};

export type BuildAmendProjectionInput = {
  readonly project: string;
  readonly closedSliceId: string;
  readonly amendmentSliceId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly closedEvidenceRefs: readonly string[];
};

export function buildAmendProjection(input: BuildAmendProjectionInput): AmendProjection {
  return {
    kind: "amend-projection",
    mutatesClosedSlice: false,
    followUp: createAmendmentSliceDraft({
      project: input.project,
      closedSliceId: input.closedSliceId,
      amendmentSliceId: input.amendmentSliceId,
      reason: input.reason,
      createdAt: input.createdAt,
    }),
    closedEvidenceRefs: input.closedEvidenceRefs,
  };
}
