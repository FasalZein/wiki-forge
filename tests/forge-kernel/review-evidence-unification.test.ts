import { describe, expect, test } from "bun:test";
import { reviewGateStatus } from "../../src/forge/core/reviews";

describe("Forge review evidence unification", () => {
  test("review readiness reads canonical forge_evidence review records", () => {
    const status = reviewGateStatus({
      review_policy: { required_approvals: 1 },
      forge_evidence: [
        {
          kind: "review",
          verdict: "approved",
          reviewer: "reviewer-subagent",
          recordedAt: "2026-05-17T16:00:00.000Z",
        },
      ],
    }, "wiki-forge", "WIKI-FORGE-285");

    expect(status.status).toBe("passed");
    expect(status.approvals).toBe(1);
    expect(status.evidence).toEqual([
      {
        verdict: "approved",
        reviewer: "reviewer-subagent",
        completedAt: "2026-05-17T16:00:00.000Z",
        blockers: [],
      },
    ]);
  });

  test("review readiness rejects stale canonical review evidence for an older git head", () => {
    const status = reviewGateStatus({
      review_policy: { required_approvals: 1 },
      forge_evidence: [
        {
          kind: "review",
          verdict: "approved",
          reviewer: "reviewer-subagent",
          recordedAt: "2026-05-17T16:00:00.000Z",
          git: { head: "old-head" },
        },
      ],
    }, "wiki-forge", "WIKI-FORGE-285", "new-head");

    expect(status.status).toBe("blocked");
    expect(status.approvals).toBe(0);
    expect(status.blockers).toEqual(["1 review record(s) target an older git revision"]);
  });
});
