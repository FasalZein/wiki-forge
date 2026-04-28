import type { V1EvidenceRecord } from "./evidence";

export function hasPassedTddEvidence(evidence: readonly V1EvidenceRecord[]): boolean {
  return evidence.some((record) => record.kind === "tdd" && record.result === "passed");
}

export function hasPassedTargetedVerification(evidence: readonly V1EvidenceRecord[]): boolean {
  return evidence.some((record) => record.kind === "verification" && record.verificationType === "targeted" && record.result === "passed");
}
