import { evaluateReviewGate } from "./review-gate";
import { hasPassedTargetedVerification, hasPassedTddEvidence } from "./verification-gate";
import type { V1EvidenceRecord } from "./evidence";
import type { KernelRejection } from "../kernel/rejection";
import type { LegacyClassification } from "../vault/legacy-classifier";
import type { SliceRecord, V1Diagnostic, V1RecordStatus } from "../vault/document";

export type V1SliceProjectionRecord = {
  readonly project: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: V1RecordStatus;
};

export type ForgeNextProjection =
  | {
    readonly status: "active";
    readonly project: string;
    readonly activeSliceId: string;
    readonly nextAction: "continue-active-slice";
    readonly source: "canonical-records";
  }
  | {
    readonly status: "ready";
    readonly project: string;
    readonly nextSliceId: string;
    readonly nextAction: "start-ready-slice";
    readonly source: "canonical-records";
  }
  | {
    readonly status: "empty";
    readonly project: string;
    readonly nextAction: "plan-next-slice";
    readonly source: "canonical-records";
  }
  | {
    readonly status: "conflict";
    readonly project: string;
    readonly rejection: KernelRejection;
    readonly source: "canonical-records";
  }
  | {
    readonly status: "needs-repair";
    readonly project: string;
    readonly diagnostics: readonly string[];
    readonly source: "canonical-records";
  };

export type ForgeNextInput = {
  readonly project: string;
  readonly slices: readonly V1SliceProjectionRecord[];
  readonly legacyClassifications?: readonly LegacyClassification[];
  readonly generatedProjectionActiveSliceId?: string;
};

export type V1SliceEvidenceSummary = {
  readonly tdd: "passed" | "failed" | "missing";
  readonly targetedVerification: "passed" | "failed" | "missing";
  readonly review: "approved" | "approved-with-followups" | "needs-changes" | "missing";
  readonly records: readonly V1EvidenceRecord[];
};

export type V1SliceCloseGate =
  | { readonly status: "not-ready"; readonly reason: string }
  | { readonly status: "blocked"; readonly missing: readonly string[]; readonly blockedBy?: string }
  | { readonly status: "ready"; readonly missing: readonly [] }
  | { readonly status: "closed" };

type CanonicalSliceStatus = "draft" | "ready" | "missing-gates" | "close-ready" | "rejected" | "done" | "cancelled";

export type V1SliceStatusProjection =
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
    readonly diagnostics: readonly V1Diagnostic[];
  }
  | {
    readonly status: CanonicalSliceStatus;
    readonly project: string;
    readonly sliceId: string;
    readonly title: string;
    readonly lifecycleStatus: V1RecordStatus;
    readonly parentPrd: string | null;
    readonly parentFeature: string | null;
    readonly sourcePaths: readonly string[];
    readonly claimedBy: string | null;
    readonly claimedAt: string | null;
    readonly closedBy: string | null;
    readonly closedAt: string | null;
    readonly evidence: V1SliceEvidenceSummary;
    readonly closeGate: V1SliceCloseGate;
    readonly nextAction: "finish-planning-or-release" | "start-slice" | "record-tdd-evidence" | "record-targeted-verification" | "record-review-evidence" | "address-review-feedback" | "close-slice" | "none";
    readonly source: "canonical-records";
  };

export type V1SliceStatusInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly record: SliceRecord;
  readonly frontmatter: {
    readonly claimedBy: string | null;
    readonly claimedAt: string | null;
    readonly closedBy: string | null;
    readonly closedAt: string | null;
  };
  readonly evidence: readonly V1EvidenceRecord[];
};

export function projectSliceToStatus(input: V1SliceStatusInput): V1SliceStatusProjection {
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
    source: "canonical-records",
  };
}

export function collectLegacyDiagnostics(classifications: readonly LegacyClassification[] = []): readonly string[] {
  return classifications.flatMap((classification) => {
    if (classification.status !== "repairable" && classification.status !== "quarantined") return [];
    return classification.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  });
}

function summarizeEvidence(evidence: readonly V1EvidenceRecord[]): V1SliceEvidenceSummary {
  const tdd = evidence.findLast((record): record is Extract<V1EvidenceRecord, { readonly kind: "tdd" }> => record.kind === "tdd");
  const targetedVerification = evidence.findLast((record): record is Extract<V1EvidenceRecord, { readonly kind: "verification" }> => record.kind === "verification" && record.verificationType === "targeted");
  const review = evidence.findLast((record): record is Extract<V1EvidenceRecord, { readonly kind: "review" }> => record.kind === "review");
  return {
    tdd: tdd?.result ?? "missing",
    targetedVerification: targetedVerification?.result ?? "missing",
    review: review?.verdict ?? "missing",
    records: evidence,
  };
}

function resolveCloseGate(lifecycleStatus: V1RecordStatus, evidence: readonly V1EvidenceRecord[]): V1SliceCloseGate {
  if (lifecycleStatus === "done") return { status: "closed" };
  if (lifecycleStatus === "draft" || lifecycleStatus === "ready" || lifecycleStatus === "cancelled") {
    return { status: "not-ready", reason: `slice lifecycle status is ${lifecycleStatus}` };
  }

  const missing: string[] = [];
  if (!hasPassedTddEvidence(evidence)) missing.push("tdd");
  if (!hasPassedTargetedVerification(evidence)) missing.push("targeted-verification");
  const reviewGate = evaluateReviewGate(evidence, { required: true });
  if (reviewGate.status === "missing") missing.push("review");
  if (reviewGate.status === "blocked") return { status: "blocked", missing, blockedBy: reviewGate.reason };
  if (missing.length > 0) return { status: "blocked", missing };
  return { status: "ready", missing: [] };
}

function resolveSliceStatus(lifecycleStatus: V1RecordStatus, closeGate: V1SliceCloseGate): CanonicalSliceStatus {
  if (lifecycleStatus === "draft" || lifecycleStatus === "ready" || lifecycleStatus === "done" || lifecycleStatus === "cancelled") return lifecycleStatus;
  if (closeGate.status === "ready") return "close-ready";
  if (closeGate.status === "blocked" && closeGate.blockedBy) return "rejected";
  return "missing-gates";
}

function resolveNextAction(lifecycleStatus: V1RecordStatus, closeGate: V1SliceCloseGate): Extract<V1SliceStatusProjection, { readonly title: string }>["nextAction"] {
  if (lifecycleStatus === "draft") return "finish-planning-or-release";
  if (lifecycleStatus === "ready") return "start-slice";
  if (lifecycleStatus === "done" || lifecycleStatus === "cancelled") return "none";
  if (closeGate.status === "ready") return "close-slice";
  if (closeGate.status === "blocked" && closeGate.blockedBy) return "address-review-feedback";
  if (closeGate.status === "blocked") {
    if (closeGate.missing.includes("tdd")) return "record-tdd-evidence";
    if (closeGate.missing.includes("targeted-verification")) return "record-targeted-verification";
    if (closeGate.missing.includes("review")) return "record-review-evidence";
  }
  return "none";
}
