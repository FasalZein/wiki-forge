import type { ReviewPolicy } from "./phase-gates";
import type { ForgeEvidenceRecord } from "./evidence";

export type ReviewGateResult =
  | { readonly status: "not-required" }
  | { readonly status: "approved" }
  | { readonly status: "missing"; readonly reason: string }
  | { readonly status: "blocked"; readonly reason: string };

export function evaluateReviewGate(evidence: readonly ForgeEvidenceRecord[], policy: ReviewPolicy = { required: true }): ReviewGateResult {
  if (!policy.required) return { status: "not-required" };
  const reviewRecords = evidence.filter((record) => record.kind === "review");
  if (reviewRecords.some((record) => record.verdict === "needs-changes")) {
    return { status: "blocked", reason: "review requested changes" };
  }
  if (reviewRecords.some((record) => record.verdict === "approved" || record.verdict === "approved-with-followups")) {
    return { status: "approved" };
  }
  return { status: "missing", reason: "required review evidence is missing" };
}
