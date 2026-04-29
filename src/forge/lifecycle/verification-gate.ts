import type { ForgeEvidenceRecord } from "./evidence";
export { hasPassedTddEvidence } from "./tdd-gate";

export function hasPassedTargetedVerification(evidence: readonly ForgeEvidenceRecord[]): boolean {
  return evidence.some((record) => record.kind === "verification" && record.verificationType === "targeted" && record.result === "passed");
}
