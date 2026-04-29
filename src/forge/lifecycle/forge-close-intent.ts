import type { AcceptedChangeSet } from "../kernel/changeset";
import type { CloseSliceIntent } from "../kernel/intent";
import { createKernelRejection } from "../kernel/rejection";
import { acceptKernelIntent, rejectKernelIntent, type KernelResult } from "../kernel/result";
import type { AmendmentSliceDraft, ForgeEvidenceRecord } from "./evidence";
import type { ReviewPolicy } from "./phase-gates";
import { evaluateReviewGate } from "./review-gate";
import { hasPassedTargetedVerification, hasPassedTddEvidence } from "./verification-gate";
import { sliceHubPath } from "./active-slice-invariant";

export type CloseSliceState = {
  readonly project: string;
  readonly sliceId: string;
  readonly evidence: readonly ForgeEvidenceRecord[];
  readonly reviewPolicy?: ReviewPolicy;
};

export type CreateAmendmentSliceDraftInput = {
  readonly project: string;
  readonly closedSliceId: string;
  readonly amendmentSliceId: string;
  readonly reason: string;
  readonly createdAt: string;
};

export function evaluateCloseSliceIntent(intent: CloseSliceIntent, state: CloseSliceState): KernelResult {
  if (!hasPassedTddEvidence(state.evidence)) {
    return rejectKernelIntent(intent, createKernelRejection({
      code: "MissingTddEvidence",
      reason: "The slice cannot close until passing TDD evidence is recorded.",
      invariant: "required-evidence-before-close",
      affected: affectedSlice(state.project, state.sliceId),
      recovery: [{
        command: `wiki forge evidence ${state.project} ${state.sliceId} tdd --red <red> --green <green> --command <cmd>`,
        description: "Record red/green TDD evidence for the slice.",
        safeToRetry: true,
      }],
      metadata: closeMetadata(state),
    }));
  }

  if (!hasPassedTargetedVerification(state.evidence)) {
    return rejectKernelIntent(intent, createKernelRejection({
      code: "MissingVerificationEvidence",
      reason: "The slice cannot close until targeted verification evidence is recorded.",
      invariant: "required-evidence-before-close",
      affected: affectedSlice(state.project, state.sliceId),
      recovery: [{
        command: `wiki forge evidence ${state.project} ${state.sliceId} verify --command <cmd> --repo .`,
        description: "Record targeted verification evidence from the slice test plan.",
        safeToRetry: true,
      }],
      metadata: closeMetadata(state),
    }));
  }

  const reviewGate = evaluateReviewGate(state.evidence, state.reviewPolicy ?? { required: true });
  if (reviewGate.status === "missing" || reviewGate.status === "blocked") {
    return rejectKernelIntent(intent, createKernelRejection({
      code: "ReviewGateMissing",
      reason: reviewGate.reason,
      invariant: "review-before-close",
      affected: affectedSlice(state.project, state.sliceId),
      recovery: [{
        command: `wiki forge review record ${state.project} ${state.sliceId} --verdict approved --reviewer <name>`,
        description: "Record required review evidence before close.",
        safeToRetry: true,
      }],
      metadata: closeMetadata(state),
    }));
  }

  return acceptKernelIntent(intent, buildCloseChangeSet(intent, state));
}

export function createAmendmentSliceDraft(input: CreateAmendmentSliceDraftInput): AmendmentSliceDraft {
  return {
    project: input.project,
    taskId: input.amendmentSliceId,
    amendmentOf: input.closedSliceId,
    amendmentReason: input.reason,
    createdAt: input.createdAt,
    status: "draft",
    dependsOn: [input.closedSliceId],
  };
}

function buildCloseChangeSet(intent: CloseSliceIntent, state: CloseSliceState): AcceptedChangeSet {
  const path = sliceHubPath(state.project, state.sliceId);
  return {
    kind: "accepted-changeset",
    id: `forge-close:${state.project}:${state.sliceId}`,
    intentId: intent.id,
    createdAt: intent.context.requestedAt,
    authority: {
      scope: "forge-lifecycle",
      fieldAuthority: "evidence",
      actorId: intent.actor.id,
      reason: "CloseSlice intent records terminal lifecycle evidence after all required gates pass.",
    },
    targetRecords: [{ kind: "slice", project: state.project, id: state.sliceId, path }],
    operations: [{
      kind: "update-record",
      target: { kind: "slice", project: state.project, id: state.sliceId, path },
      fields: [
        { name: "status", authority: "authored", value: "done" },
        { name: "closed_by", authority: "evidence", value: intent.payload.closedBy },
        { name: "closed_at", authority: "evidence", value: intent.context.requestedAt },
        { name: "closure_evidence", authority: "evidence", value: ["tdd", "verification", "review"] },
      ],
    }],
    affectedFiles: [{
      path,
      authority: "evidence",
      reason: "Slice hub receives immutable closure evidence.",
    }],
  };
}

function affectedSlice(project: string, sliceId: string) {
  const path = sliceHubPath(project, sliceId);
  return {
    records: [{ kind: "slice" as const, project, id: sliceId, path }],
    files: [{ path, reason: "Slice cannot close until the evidence gate is satisfied." }],
  };
}

function closeMetadata(state: CloseSliceState) {
  return {
    project: state.project,
    sliceId: state.sliceId,
  };
}
