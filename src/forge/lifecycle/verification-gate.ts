import type { ForgeEvidenceRecord } from "./evidence";

export function hasPassedTddEvidence(evidence: readonly ForgeEvidenceRecord[]): boolean {
  return evidence.some((record) => record.kind === "tdd" && record.result === "passed");
}

export function hasPassedTargetedVerification(evidence: readonly ForgeEvidenceRecord[]): boolean {
  return evidence.some((record) => record.kind === "verification" && record.verificationType === "targeted" && record.result === "passed");
}
