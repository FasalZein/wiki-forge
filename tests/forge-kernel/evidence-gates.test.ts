import { describe, expect, test } from "bun:test";
import { hasPassedTargetedVerification, hasPassedTddEvidence } from "../../src/forge/lifecycle/verification-gate";
import { evaluateReviewGate } from "../../src/forge/lifecycle/review-gate";
import type { ForgeEvidenceRecord } from "../../src/forge/lifecycle/evidence";

const tddEvidence: ForgeEvidenceRecord = {
  kind: "tdd",
  command: "bun test tests/forge-kernel/forge-close-gates.test.ts",
  result: "passed",
  recordedAt: "2026-04-28T04:32:00.000Z",
};

const targetedVerification: ForgeEvidenceRecord = {
  kind: "verification",
  verificationType: "targeted",
  command: "bun run check",
  result: "passed",
  recordedAt: "2026-04-28T04:32:01.000Z",
};

describe("forge evidence gates", () => {
  test("TDD evidence is modeled separately from generated status text", () => {
    expect(hasPassedTddEvidence([tddEvidence])).toBe(true);
    expect(hasPassedTddEvidence([{ ...tddEvidence, result: "failed" }])).toBe(false);
  });

  test("targeted verification evidence is required; full-suite evidence alone is not the slice close gate", () => {
    const fullSuiteOnly: ForgeEvidenceRecord = {
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
