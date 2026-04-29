import { describe, expect, test } from "bun:test";
import type { ForgeEvidenceRecord, TddEvidenceRecord } from "../../src/forge/lifecycle/evidence";
import { evaluateTddGate, hasPassedTddEvidence } from "../../src/forge/lifecycle/tdd-gate";

const red: TddEvidenceRecord = {
  kind: "tdd",
  phase: "red",
  command: "bun test tests/forge-kernel/tdd-gate.test.ts",
  testPaths: ["tests/forge-kernel/tdd-gate.test.ts"],
  result: "failed",
  note: "expected failure before implementation",
  recordedAt: "2026-04-29T10:00:00.000Z",
};

const green: TddEvidenceRecord = {
  ...red,
  phase: "green",
  result: "passed",
  note: "same command now passes",
  recordedAt: "2026-04-29T10:05:00.000Z",
};

const legacyCoarseTdd: ForgeEvidenceRecord = {
  kind: "tdd",
  command: red.command,
  result: "passed",
  recordedAt: "2026-04-29T10:06:00.000Z",
};

describe("forge TDD gate", () => {
  test("missing evidence returns missing-red with recovery", () => {
    expect(evaluateTddGate([], { project: "wiki-forge", sliceId: "WIKI-FORGE-001" })).toEqual({
      status: "missing-red",
      recovery: {
        command: "wiki forge tdd red wiki-forge WIKI-FORGE-001 --test <path> --command \"<failing test command>\"",
        description: "Record the failing red step before implementing the fix.",
      },
    });
  });

  test("red-only evidence asks for green with the red command and path", () => {
    expect(evaluateTddGate([red], { project: "wiki-forge", sliceId: "WIKI-FORGE-001" })).toEqual({
      status: "missing-green",
      red,
      recovery: {
        command: "wiki forge tdd green wiki-forge WIKI-FORGE-001 --test tests/forge-kernel/tdd-gate.test.ts --command \"bun test tests/forge-kernel/tdd-gate.test.ts\"",
        description: "Record the passing green step using the same command and at least one same test path.",
      },
    });
  });

  test("green-only and legacy coarse records do not pass", () => {
    expect(evaluateTddGate([green]).status).toBe("missing-red");
    expect(evaluateTddGate([legacyCoarseTdd]).status).toBe("missing-red");
    expect(hasPassedTddEvidence([legacyCoarseTdd])).toBe(false);
  });

  test("red failed plus later green passed with same command and shared path passes", () => {
    expect(evaluateTddGate([red, green])).toEqual({ status: "passed", red, green });
    expect(hasPassedTddEvidence([red, green])).toBe(true);
  });

  test("different command blocks with actionable invalid-sequence reason", () => {
    const mismatchedGreen: TddEvidenceRecord = { ...green, command: "bun test tests/other.test.ts" };
    expect(evaluateTddGate([red, mismatchedGreen])).toEqual({
      status: "invalid-sequence",
      reason: "green TDD evidence must use the exact same command as the red evidence",
      recovery: {
        command: "wiki forge tdd green <project> <slice-id> --test tests/forge-kernel/tdd-gate.test.ts --command \"bun test tests/forge-kernel/tdd-gate.test.ts\"",
        description: "Record the passing green step using the same command and at least one same test path.",
      },
    });
  });

  test("no shared test path blocks the gate", () => {
    const mismatchedGreen: TddEvidenceRecord = { ...green, testPaths: ["tests/other.test.ts"] };
    expect(evaluateTddGate([red, mismatchedGreen]).status).toBe("invalid-sequence");
    expect(hasPassedTddEvidence([red, mismatchedGreen])).toBe(false);
  });

  test("multiple cycles pass when any valid red green pair exists", () => {
    const firstGreen: TddEvidenceRecord = { ...green, command: "bun test tests/other.test.ts", recordedAt: "2026-04-29T10:03:00.000Z" };
    expect(evaluateTddGate([red, firstGreen, green])).toEqual({ status: "passed", red, green });
  });
});
