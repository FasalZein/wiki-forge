import { describe, expect, test } from "bun:test";
import type { StartSliceIntent } from "../../src/v1/kernel/intent";
import { evaluateStartSliceIntent } from "../../src/v1/forge/start-slice-intent";
import type { ForgeProjectState } from "../../src/v1/forge/types";

const startIntent: StartSliceIntent = {
  kind: "intent",
  id: "intent-start-214",
  type: "start-slice",
  actor: {
    kind: "agent",
    id: "codex",
  },
  context: {
    project: "wiki-forge",
    sliceId: "WIKI-FORGE-214",
    requestedAt: "2026-04-28T04:25:00.000Z",
  },
  payload: {
    sliceId: "WIKI-FORGE-214",
    agent: "codex",
  },
};

function projectState(activeSliceIds: readonly string[]): ForgeProjectState {
  return {
    project: "wiki-forge",
    activeSlices: activeSliceIds.map((sliceId) => ({
      project: "wiki-forge",
      sliceId,
      claimedBy: "codex",
      claimedAt: "2026-04-28T04:00:00.000Z",
    })),
  };
}

describe("v1 active slice invariant", () => {
  test("StartSlice succeeds with no active slice", () => {
    const result = evaluateStartSliceIntent(startIntent, projectState([]));

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("expected start intent to be accepted");
    expect(result.changeset.authority.scope).toBe("forge-lifecycle");
    expect(result.changeset.targetRecords.map((record) => record.id)).toEqual(["WIKI-FORGE-214"]);
    expect(result.changeset.affectedFiles[0]?.path).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-214/index.md");
  });

  test("StartSlice rejects with AnotherSliceActive when one slice is active", () => {
    const result = evaluateStartSliceIntent(startIntent, projectState(["WIKI-FORGE-213"]));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected start intent to be rejected");
    expect(result.rejection.code).toBe("AnotherSliceActive");
    expect(result.rejection.invariant).toBe("single-active-slice");
    expect(result.rejection.metadata).toEqual({
      project: "wiki-forge",
      attemptedSliceId: "WIKI-FORGE-214",
      activeSliceIds: ["WIKI-FORGE-213"],
    });
    expect(result.rejection.affected.records.map((record) => record.id)).toEqual(["WIKI-FORGE-213", "WIKI-FORGE-214"]);
  });

  test("legacy state with two active slices rejects with MultipleActiveSlices", () => {
    const result = evaluateStartSliceIntent(startIntent, projectState(["WIKI-FORGE-211", "WIKI-FORGE-213"]));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected start intent to be rejected");
    expect(result.rejection.code).toBe("MultipleActiveSlices");
    expect(result.rejection.metadata).toEqual({
      project: "wiki-forge",
      attemptedSliceId: "WIKI-FORGE-214",
      activeSliceIds: ["WIKI-FORGE-211", "WIKI-FORGE-213"],
    });
  });

  test("rejection includes release and takeover recovery hints", () => {
    const result = evaluateStartSliceIntent(startIntent, projectState(["WIKI-FORGE-213"]));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected start intent to be rejected");
    expect(result.rejection.recovery).toEqual([
      {
        command: "wiki forge release wiki-forge WIKI-FORGE-213 --reason \"release before starting WIKI-FORGE-214\"",
        description: "Release the currently active slice before starting WIKI-FORGE-214.",
        safeToRetry: true,
      },
      {
        command: "wiki forge start wiki-forge WIKI-FORGE-214 --takeover --reason \"replace active WIKI-FORGE-213\"",
        description: "Take over only after recording why WIKI-FORGE-213 is no longer the active work.",
        safeToRetry: false,
      },
    ]);
  });
});
