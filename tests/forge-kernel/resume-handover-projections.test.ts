import { describe, expect, test } from "bun:test";
import { buildAmendProjection } from "../../src/wiki/memory/projections/amend";
import { buildHandoverProjection } from "../../src/wiki/memory/projections/handover";
import { buildResumeProjection } from "../../src/wiki/memory/projections/resume";

describe("forge resume handover amend projections", () => {
  test("resume packet cites status truth and does not mutate lifecycle state", () => {
    expect(buildResumeProjection({
      project: "wiki-forge",
      statusTruth: {
        status: "active",
        project: "wiki-forge",
        activeSliceId: "WIKI-FORGE-219",
        nextAction: "continue-active-slice",
        source: "canonical-records",
      },
      context: ["Forge rewrite in progress", "use targeted verification"],
    })).toEqual({
      kind: "resume-projection",
      project: "wiki-forge",
      mutatesLifecycle: false,
      authoritativeStatusSource: "canonical-records",
      activeSliceId: "WIKI-FORGE-219",
      nextAction: "continue-active-slice",
      context: ["Forge rewrite in progress", "use targeted verification"],
    });
  });

  test("handover contains target phase blockers and next command", () => {
    expect(buildHandoverProjection({
      project: "wiki-forge",
      targetSliceId: "WIKI-FORGE-219",
      canonicalActiveSliceId: "WIKI-FORGE-219",
      phase: "tdd",
      runState: "in-progress",
      blockers: ["dogfood release gate pending"],
      nextCommand: "bun test tests/forge-kernel/resume-handover-projections.test.ts",
    })).toEqual({
      kind: "handover-projection",
      project: "wiki-forge",
      targetSliceId: "WIKI-FORGE-219",
      canonicalActiveSliceId: "WIKI-FORGE-219",
      phase: "tdd",
      runState: "in-progress",
      blockers: ["dogfood release gate pending"],
      nextCommand: "bun test tests/forge-kernel/resume-handover-projections.test.ts",
      recovery: [],
    });
  });

  test("stale handover disagreement produces recovery guidance", () => {
    expect(buildHandoverProjection({
      project: "wiki-forge",
      targetSliceId: "WIKI-FORGE-218",
      canonicalActiveSliceId: "WIKI-FORGE-219",
      phase: "tdd",
      runState: "in-progress",
      blockers: [],
      nextCommand: "wiki forge run wiki-forge WIKI-FORGE-218 --repo .",
    }).recovery).toEqual([
      {
        command: "wiki forge status wiki-forge WIKI-FORGE-219 --repo . --json",
        reason: "handover target WIKI-FORGE-218 disagrees with canonical active slice WIKI-FORGE-219",
      },
    ]);
  });

  test("amend creates new follow-up and preserves closed slice history", () => {
    expect(buildAmendProjection({
      project: "wiki-forge",
      closedSliceId: "WIKI-FORGE-218",
      amendmentSliceId: "WIKI-FORGE-222",
      reason: "follow-up docs polish",
      createdAt: "2026-04-28T04:48:00.000Z",
      closedEvidenceRefs: ["closure:WIKI-FORGE-218"],
    })).toEqual({
      kind: "amend-projection",
      mutatesClosedSlice: false,
      followUp: {
        project: "wiki-forge",
        taskId: "WIKI-FORGE-222",
        amendmentOf: "WIKI-FORGE-218",
        amendmentReason: "follow-up docs polish",
        createdAt: "2026-04-28T04:48:00.000Z",
        status: "draft",
        dependsOn: ["WIKI-FORGE-218"],
      },
      closedEvidenceRefs: ["closure:WIKI-FORGE-218"],
    });
  });

  test("projection regeneration is idempotent", () => {
    const input = {
      project: "wiki-forge",
      targetSliceId: "WIKI-FORGE-219",
      canonicalActiveSliceId: "WIKI-FORGE-219",
      phase: "verification",
      runState: "ready-to-close",
      blockers: [],
      nextCommand: "wiki forge run wiki-forge WIKI-FORGE-219 --repo .",
    } as const;

    expect(buildHandoverProjection(input)).toEqual(buildHandoverProjection(input));
  });
});
