import { describe, expect, test } from "bun:test";
import type { CloseSliceIntent } from "../../src/v1/kernel/intent";
import { createAmendmentSliceDraft, evaluateCloseSliceIntent } from "../../src/v1/forge/close-slice-intent";
import type { V1EvidenceRecord } from "../../src/v1/forge/evidence";

const closeIntent: CloseSliceIntent = {
  kind: "intent",
  id: "intent-close-218",
  type: "close-slice",
  actor: {
    kind: "agent",
    id: "codex",
  },
  context: {
    project: "wiki-forge",
    sliceId: "WIKI-FORGE-218",
    requestedAt: "2026-04-28T04:33:00.000Z",
  },
  payload: {
    sliceId: "WIKI-FORGE-218",
    closedBy: "codex",
  },
};

const passedTdd: V1EvidenceRecord = {
  kind: "tdd",
  command: "bun test tests/v1/evidence-gates.test.ts tests/v1/close-slice-gates.test.ts",
  result: "passed",
  recordedAt: "2026-04-28T04:33:01.000Z",
};

const passedVerification: V1EvidenceRecord = {
  kind: "verification",
  verificationType: "targeted",
  command: "bun run check",
  result: "passed",
  recordedAt: "2026-04-28T04:33:02.000Z",
};

const approvedReview: V1EvidenceRecord = {
  kind: "review",
  reviewer: "gpt-5.5-reviewer",
  verdict: "approved",
  recordedAt: "2026-04-28T04:33:03.000Z",
};

describe("v1 close slice evidence gates", () => {
  test("close rejects missing TDD evidence", () => {
    const result = evaluateCloseSliceIntent(closeIntent, {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-218",
      evidence: [passedVerification, approvedReview],
      reviewPolicy: { required: true },
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.code).toBe("MissingTddEvidence");
    expect(result.rejection.recovery[0]?.command).toContain("wiki forge evidence wiki-forge WIKI-FORGE-218 tdd");
  });

  test("close rejects missing targeted verification evidence", () => {
    const result = evaluateCloseSliceIntent(closeIntent, {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-218",
      evidence: [passedTdd, approvedReview],
      reviewPolicy: { required: true },
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.code).toBe("MissingVerificationEvidence");
    expect(result.rejection.recovery[0]?.command).toBe("wiki verify-slice wiki-forge WIKI-FORGE-218 --repo .");
  });

  test("close rejects missing required review evidence", () => {
    const result = evaluateCloseSliceIntent(closeIntent, {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-218",
      evidence: [passedTdd, passedVerification],
      reviewPolicy: { required: true },
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.code).toBe("ReviewGateMissing");
    expect(result.rejection.recovery[0]?.command).toBe("wiki forge review record wiki-forge WIKI-FORGE-218 --verdict approved --reviewer <name>");
  });

  test("close succeeds only with all required gates and records immutable closure evidence", () => {
    const result = evaluateCloseSliceIntent(closeIntent, {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-218",
      evidence: [passedTdd, passedVerification, approvedReview],
      reviewPolicy: { required: true },
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("expected accepted close");
    expect(result.changeset.authority.scope).toBe("forge-lifecycle");
    expect(result.changeset.operations).toEqual([
      {
        kind: "update-record",
        target: {
          kind: "slice",
          project: "wiki-forge",
          id: "WIKI-FORGE-218",
          path: "projects/wiki-forge/forge/slices/WIKI-FORGE-218/index.md",
        },
        fields: [
          { name: "status", authority: "authored", value: "done" },
          { name: "closed_by", authority: "evidence", value: "codex" },
          { name: "closed_at", authority: "evidence", value: "2026-04-28T04:33:00.000Z" },
          { name: "closure_evidence", authority: "evidence", value: ["tdd", "verification", "review"] },
        ],
      },
    ]);
  });

  test("amend produces a new linked slice and leaves closed slice immutable", () => {
    const draft = createAmendmentSliceDraft({
      project: "wiki-forge",
      closedSliceId: "WIKI-FORGE-218",
      amendmentSliceId: "WIKI-FORGE-220",
      reason: "follow-up projection integration",
      createdAt: "2026-04-28T04:34:00.000Z",
    });

    expect(draft).toEqual({
      project: "wiki-forge",
      taskId: "WIKI-FORGE-220",
      amendmentOf: "WIKI-FORGE-218",
      amendmentReason: "follow-up projection integration",
      createdAt: "2026-04-28T04:34:00.000Z",
      status: "draft",
      dependsOn: ["WIKI-FORGE-218"],
    });
  });
});
