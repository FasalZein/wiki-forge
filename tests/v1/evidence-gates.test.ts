import { describe, expect, test } from "bun:test";
import { hasPassedTargetedVerification, hasPassedTddEvidence } from "../../src/v1/forge/verification-gate";
import { evaluateReviewGate } from "../../src/v1/forge/review-gate";
import type { V1EvidenceRecord } from "../../src/v1/forge/evidence";

const tddEvidence: V1EvidenceRecord = {
  kind: "tdd",
  command: "bun test tests/v1/close-slice-gates.test.ts",
  result: "passed",
  recordedAt: "2026-04-28T04:32:00.000Z",
};

const targetedVerification: V1EvidenceRecord = {
  kind: "verification",
  verificationType: "targeted",
  command: "bun run check",
  result: "passed",
  recordedAt: "2026-04-28T04:32:01.000Z",
};

describe("v1 evidence gates", () => {
  test("TDD evidence is modeled separately from generated status text", () => {
    expect(hasPassedTddEvidence([tddEvidence])).toBe(true);
    expect(hasPassedTddEvidence([{ ...tddEvidence, result: "failed" }])).toBe(false);
  });

  test("targeted verification evidence is required; full-suite evidence alone is not the slice close gate", () => {
    const fullSuiteOnly: V1EvidenceRecord = {
      kind: "verification",
      verificationType: "full-suite",
      command: "bun test",
      result: "passed",
      recordedAt: "2026-04-28T04:32:02.000Z",
    };

    expect(hasPassedTargetedVerification([fullSuiteOnly])).toBe(false);
    expect(hasPassedTargetedVerification([fullSuiteOnly, targetedVerification])).toBe(true);
  });

  test("review is required by default unless policy disables it", () => {
    expect(evaluateReviewGate([], { required: true })).toEqual({
      status: "missing",
      reason: "required review evidence is missing",
    });
    expect(evaluateReviewGate([], { required: false })).toEqual({ status: "not-required" });
    expect(evaluateReviewGate([
      {
        kind: "review",
        reviewer: "gpt-5.5-reviewer",
        verdict: "approved",
        recordedAt: "2026-04-28T04:32:03.000Z",
      },
    ], { required: true })).toEqual({ status: "approved" });
  });
});
