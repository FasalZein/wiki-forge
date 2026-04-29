export type ForgeEvidenceResult = "passed" | "failed";

export type TddEvidenceRecord = {
  readonly kind: "tdd";
  readonly command: string;
  readonly result: ForgeEvidenceResult;
  readonly recordedAt: string;
};

export type VerificationEvidenceRecord = {
  readonly kind: "verification";
  readonly verificationType: "targeted" | "full-suite";
  readonly command: string;
  readonly result: ForgeEvidenceResult;
  readonly recordedAt: string;
};

export type ReviewEvidenceRecord = {
  readonly kind: "review";
  readonly reviewer: string;
  readonly verdict: "approved" | "needs-changes" | "approved-with-followups";
  readonly recordedAt: string;
};

export type ClosureEvidenceRecord = {
  readonly kind: "closure";
  readonly closedBy: string;
  readonly closedAt: string;
  readonly requiredEvidence: readonly string[];
};

export type ForgeEvidenceRecord = TddEvidenceRecord | VerificationEvidenceRecord | ReviewEvidenceRecord | ClosureEvidenceRecord;

export type AmendmentSliceDraft = {
  readonly project: string;
  readonly taskId: string;
  readonly amendmentOf: string;
  readonly amendmentReason: string;
  readonly createdAt: string;
  readonly status: "draft";
  readonly dependsOn: readonly string[];
};
