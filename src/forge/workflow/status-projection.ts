import { evaluateReviewGate } from "../lifecycle/review-gate";
import { hasPassedTargetedVerification } from "../lifecycle/verification-gate";
import { evaluateTddGate } from "../lifecycle/tdd-gate";
import type { ForgeEvidenceRecord } from "../lifecycle/evidence";
import type { KernelRejection } from "../kernel/rejection";
import { buildPhaseSkillPacket, type PhaseSkillPacket } from "./phase-skill-packet";
import type { SliceRecord, ForgeDiagnostic, ForgeRecordStatus } from "../vault/document";

export type SliceProjectionRecord = {
  readonly project: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: ForgeRecordStatus;
};

export type ForgeDraftSliceCandidate = {
  readonly sliceId: string;
  readonly title: string;
  readonly commands: {
    readonly release: string;
    readonly startAfterRelease: string;
  };
};

export type ForgeActionableCandidate = {
  readonly sliceId: string;
  readonly title: string;
  readonly nextCommand: string;
};

export type PlanningSessionProjectionRecord = {
  readonly project: string;
  readonly featureName: string;
  readonly sessionId: string;
  readonly status: "draft" | "ready-for-artifacts" | "artifacts-created";
};

type ForgeActionableFields = {
  readonly reason: string;
  readonly nextCommand?: string;
  readonly noSafeCommandReason?: string;
  readonly candidates?: readonly ForgeActionableCandidate[];
  readonly phasePacket?: PhaseSkillPacket;
};

export type ForgeNextProjection =
  | ({
    readonly status: "active";
    readonly project: string;
    readonly activeSliceId: string;
    readonly nextAction: "continue-active-slice";
    readonly source: "canonical-records";
  } & ForgeActionableFields)
  | ({
    readonly status: "ready";
    readonly project: string;
    readonly nextSliceId: string;
    readonly nextAction: "start-ready-slice";
    readonly source: "canonical-records";
  } & ForgeActionableFields)
  | ({
    readonly status: "drafts";
    readonly project: string;
    readonly draftSlices: readonly ForgeDraftSliceCandidate[];
    readonly nextAction: "release-draft-slice";
    readonly source: "canonical-records";
  } & ForgeActionableFields)
  | ({
    readonly status: "planning-session";
    readonly project: string;
    readonly featureName: string;
    readonly sessionId: string;
    readonly planningStatus: "draft" | "ready-for-artifacts";
    readonly nextAction: "continue-planning-session" | "create-planning-artifacts";
    readonly source: "canonical-records";
  } & ForgeActionableFields)
  | ({
    readonly status: "empty";
    readonly project: string;
    readonly nextAction: "project-complete-or-plan-more-scope";
    readonly source: "canonical-records";
  } & ForgeActionableFields)
  | ({
    readonly status: "conflict";
    readonly project: string;
    readonly rejection: KernelRejection;
    readonly source: "canonical-records";
  } & ForgeActionableFields)
  | ({
    readonly status: "needs-repair";
    readonly project: string;
    readonly diagnostics: readonly string[];
    readonly source: "canonical-records";
  } & ForgeActionableFields);

export type ForgeNextInput = {
  readonly project: string;
  readonly slices: readonly SliceProjectionRecord[];
  readonly planningSessions?: readonly PlanningSessionProjectionRecord[];
  readonly generatedProjectionActiveSliceId?: string;
};

export type SliceEvidenceSummary = {
  readonly tdd: "passed" | "failed" | "missing";
  readonly targetedVerification: "passed" | "failed" | "missing";
  readonly review: "approved" | "approved-with-followups" | "needs-changes" | "missing";
  readonly records: readonly ForgeEvidenceRecord[];
};

export type SliceCloseGate =
  | { readonly status: "not-ready"; readonly reason: string }
  | { readonly status: "blocked"; readonly missing: readonly string[]; readonly blockedBy?: string }
  | { readonly status: "ready"; readonly missing: readonly [] }
  | { readonly status: "closed" };

type CanonicalSliceStatus = "draft" | "ready" | "missing-gates" | "close-ready" | "rejected" | "done" | "cancelled";

export type SliceStatusProjection =
  | {
    readonly status: "missing";
    readonly project: string;
    readonly sliceId: string;
    readonly source: "canonical-records";
    readonly diagnostics: readonly string[];
  }
  | {
    readonly status: "needs-repair";
    readonly project: string;
    readonly sliceId: string;
    readonly source: "canonical-records";
    readonly diagnostics: readonly ForgeDiagnostic[];
  }
  | {
    readonly status: CanonicalSliceStatus;
    readonly project: string;
    readonly sliceId: string;
    readonly title: string;
    readonly lifecycleStatus: ForgeRecordStatus;
    readonly parentPrd: string | null;
    readonly parentFeature: string | null;
    readonly sourcePaths: readonly string[];
    readonly claimedBy: string | null;
    readonly claimedAt: string | null;
    readonly closedBy: string | null;
    readonly closedAt: string | null;
    readonly evidence: SliceEvidenceSummary;
    readonly closeGate: SliceCloseGate;
    readonly nextAction: "finish-planning-or-release" | "forge-start" | "record-tdd-evidence" | "record-targeted-verification" | "record-review-evidence" | "address-review-feedback" | "forge-close" | "none";
    readonly phasePacket?: PhaseSkillPacket;
    readonly source: "canonical-records";
  };

export type SliceStatusInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly record: SliceRecord;
  readonly frontmatter: {
    readonly claimedBy: string | null;
    readonly claimedAt: string | null;
    readonly closedBy: string | null;
    readonly closedAt: string | null;
  };
  readonly evidence: readonly ForgeEvidenceRecord[];
};

export function projectSliceToStatus(input: SliceStatusInput): SliceStatusProjection {
  const evidence = summarizeEvidence(input.evidence);
  const closeGate = resolveCloseGate(input.record.status, input.evidence);
  const status = resolveSliceStatus(input.record.status, closeGate);
  return {
    status,
    project: input.project,
    sliceId: input.sliceId,
    title: input.record.title,
    lifecycleStatus: input.record.status,
    parentPrd: input.record.parentPrd ?? null,
    parentFeature: input.record.parentFeature ?? null,
    sourcePaths: input.record.sourcePaths,
    claimedBy: input.frontmatter.claimedBy,
    claimedAt: input.frontmatter.claimedAt,
    closedBy: input.frontmatter.closedBy,
    closedAt: input.frontmatter.closedAt,
    evidence,
    closeGate,
    nextAction: resolveNextAction(input.record.status, closeGate),
    ...(input.record.status === "in-progress" ? { phasePacket: buildPhaseSkillPacket("implementation", { project: input.project, sliceId: input.sliceId }) } : {}),
    source: "canonical-records",
  };
}

function summarizeEvidence(evidence: readonly ForgeEvidenceRecord[]): SliceEvidenceSummary {
  const tddGate = evaluateTddGate(evidence);
  const targetedVerification = evidence.findLast((record): record is Extract<ForgeEvidenceRecord, { readonly kind: "verification" }> => record.kind === "verification" && record.verificationType === "targeted");
  const review = evidence.findLast((record): record is Extract<ForgeEvidenceRecord, { readonly kind: "review" }> => record.kind === "review");
  const tdd = summarizeTddGate(tddGate.status);
  return {
    tdd,
    targetedVerification: targetedVerification?.result ?? "missing",
    review: review?.verdict ?? "missing",
    records: evidence,
  };
}

function summarizeTddGate(status: ReturnType<typeof evaluateTddGate>["status"]): SliceEvidenceSummary["tdd"] {
  if (status === "passed") return "passed";
  if (status === "invalid-sequence") return "failed";
  return "missing";
}

function resolveCloseGate(lifecycleStatus: ForgeRecordStatus, evidence: readonly ForgeEvidenceRecord[]): SliceCloseGate {
  if (lifecycleStatus === "done") return { status: "closed" };
  if (lifecycleStatus === "draft" || lifecycleStatus === "ready" || lifecycleStatus === "cancelled") {
    return { status: "not-ready", reason: `slice lifecycle status is ${lifecycleStatus}` };
  }

  const missing: string[] = [];
  const tddGate = evaluateTddGate(evidence);
  if (tddGate.status === "invalid-sequence") return { status: "blocked", missing: ["tdd"], blockedBy: tddGate.reason };
  if (tddGate.status !== "passed") missing.push("tdd");
  if (!hasPassedTargetedVerification(evidence)) missing.push("targeted-verification");
  const reviewGate = evaluateReviewGate(evidence, { required: true });
  if (reviewGate.status === "missing") missing.push("review");
  if (reviewGate.status === "blocked") return { status: "blocked", missing, blockedBy: reviewGate.reason };
  if (missing.length > 0) return { status: "blocked", missing };
  return { status: "ready", missing: [] };
}

function resolveSliceStatus(lifecycleStatus: ForgeRecordStatus, closeGate: SliceCloseGate): CanonicalSliceStatus {
  if (lifecycleStatus === "draft" || lifecycleStatus === "ready" || lifecycleStatus === "done" || lifecycleStatus === "cancelled") return lifecycleStatus;
  if (closeGate.status === "ready") return "close-ready";
  if (closeGate.status === "blocked" && closeGate.blockedBy) return "rejected";
  return "missing-gates";
}

function resolveNextAction(lifecycleStatus: ForgeRecordStatus, closeGate: SliceCloseGate): Extract<SliceStatusProjection, { readonly title: string }>["nextAction"] {
  if (lifecycleStatus === "draft") return "finish-planning-or-release";
  if (lifecycleStatus === "ready") return "forge-start";
  if (lifecycleStatus === "done" || lifecycleStatus === "cancelled") return "none";
  if (closeGate.status === "ready") return "forge-close";
  if (closeGate.status === "blocked" && closeGate.blockedBy) return "address-review-feedback";
  if (closeGate.status === "blocked") {
    if (closeGate.missing.includes("tdd")) return "record-tdd-evidence";
    if (closeGate.missing.includes("targeted-verification")) return "record-targeted-verification";
    if (closeGate.missing.includes("review")) return "record-review-evidence";
  }
  return "none";
}

