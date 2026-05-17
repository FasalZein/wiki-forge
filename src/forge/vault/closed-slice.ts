import { evaluateReviewGate } from "../lifecycle/review-gate";
import { hasPassedTargetedVerification, hasPassedTddEvidence } from "../lifecycle/verification-gate";
import { readForgeEvidence } from "./evidence-store";
import { decodeForgeRecord, parseVaultDocument } from "./records";
import { readSliceHub } from "./slice-repository";

export async function readClosedForgeSliceHub(project: string, sliceId: string, vaultRoot: string) {
  const hub = await readSliceHub(vaultRoot, project, sliceId);
  const document = parseVaultDocument(hub.path, hub.markdown);
  const decoded = decodeForgeRecord(document);
  if (decoded.status !== "valid" || decoded.record.kind !== "slice" || decoded.record.taskId !== sliceId) {
    throw new Error(`slice is not a Forge canonical slice record: ${project}/${sliceId}`);
  }
  if (decoded.record.status !== "done") {
    throw new Error(`cannot amend ${sliceId}: slice is not closed in Forge lifecycle truth`);
  }
  const evidence = await readForgeEvidence(project, sliceId, vaultRoot);
  if (!hasRequiredCloseEvidence(hub.data, evidence)) {
    throw new Error(`cannot amend ${sliceId}: slice is not closed in Forge lifecycle truth`);
  }
  return document;
}

function hasRequiredCloseEvidence(data: Record<string, unknown>, evidence: Awaited<ReturnType<typeof readForgeEvidence>>): boolean {
  const closureEvidence = readStringArray(data.forge_closure_evidence ?? data.closure_evidence);
  const hasClosureStamp = ["tdd", "verification", "review"].every((kind) => closureEvidence.includes(kind));
  if (hasClosureStamp) return true;
  return hasPassedTddEvidence(evidence)
    && hasPassedTargetedVerification(evidence)
    && evaluateReviewGate(evidence, { required: true }).status === "approved";
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : []);
}
