import { describe, expect, test } from "bun:test";
import { validateForgeWorkflowLedger, type ForgeWorkflowLedger } from "../src/protocol/status/workflow-ledger";
import {
  isSliceDocsReady,
  mergeAuthoredLedgers,
  normalizeForgeValidationForCloseableSlice,
  readAuthoredHubLedger,
} from "../src/protocol/forge-status-ledger";

describe("forge status ledger helpers", () => {
  test("readAuthoredHubLedger normalizes legacy grill storage to domain-model", () => {
    const ledger = readAuthoredHubLedger({
      grill: {
        completedAt: "2026-04-20T00:00:00.000Z",
        decisionRefs: ["projects/demo/decisions.md#current-decisions"],
      },
    }, "demo", "DEMO-001");

    expect(ledger["domain-model"]).toEqual({
      completedAt: "2026-04-20T00:00:00.000Z",
      decisionRefs: ["projects/demo/decisions.md#current-decisions"],
    });
    expect(ledger.grill).toBeUndefined();
  });

  test("readAuthoredHubLedger carries skippedPhases through snake_case and camelCase fields", () => {
    const fromCamel = readAuthoredHubLedger(
      {
        skippedPhases: [
          { phase: "research", reason: "spike", skippedAt: "2026-04-23T18:00:00.000Z", skippedBy: "agent" },
          { phase: "tdd", reason: "ignored", skippedAt: "2026-04-23T18:00:00.000Z" },
        ],
      },
      "demo",
      "DEMO-001",
    );
    expect(fromCamel.skippedPhases).toEqual([
      { phase: "research", reason: "spike", skippedAt: "2026-04-23T18:00:00.000Z", skippedBy: "agent" },
    ]);

    const fromSnake = readAuthoredHubLedger(
      { skipped_phases: [{ phase: "slices", reason: "noop", skippedAt: "2026-04-23T18:00:00.000Z" }] },
      "demo",
      "DEMO-001",
    );
    expect(fromSnake.skippedPhases).toEqual([
      { phase: "slices", reason: "noop", skippedAt: "2026-04-23T18:00:00.000Z" },
    ]);

    const fromBlankReason = readAuthoredHubLedger(
      { skippedPhases: [{ phase: "research", reason: "   ", skippedAt: "2026-04-23T18:00:00.000Z" }] },
      "demo",
      "DEMO-001",
    );
    expect(fromBlankReason.skippedPhases).toBeUndefined();
  });

  test("mergeAuthoredLedgers merges skippedPhases by phase (override wins)", () => {
    const merged = mergeAuthoredLedgers(
      {
        project: "demo",
        sliceId: "DEMO-001",
        skippedPhases: [
          { phase: "research", reason: "old", skippedAt: "2026-04-23T17:00:00.000Z" },
          { phase: "prd", reason: "old", skippedAt: "2026-04-23T17:00:00.000Z" },
        ],
      },
      {
        project: "demo",
        sliceId: "DEMO-001",
        skippedPhases: [
          { phase: "research", reason: "new", skippedAt: "2026-04-23T18:00:00.000Z" },
        ],
      },
    );
    expect(merged.skippedPhases).toEqual([
      { phase: "research", reason: "new", skippedAt: "2026-04-23T18:00:00.000Z" },
      { phase: "prd", reason: "old", skippedAt: "2026-04-23T17:00:00.000Z" },
    ]);
  });

  test("mergeAuthoredLedgers preserves base phase evidence while allowing overrides", () => {
    const merged = mergeAuthoredLedgers(
      {
        project: "demo",
        sliceId: "DEMO-001",
        research: {
          completedAt: "2026-04-20T00:00:00.000Z",
          researchRefs: ["research/demo.md"],
        },
      },
      {
        project: "demo",
        sliceId: "DEMO-001",
        research: {
          completedAt: "2026-04-21T00:00:00.000Z",
        },
      },
    );

    expect(merged.research).toEqual({
      completedAt: "2026-04-21T00:00:00.000Z",
      researchRefs: ["research/demo.md"],
    });
  });

  test("normalizeForgeValidationForCloseableSlice only force-completes docs-ready test-verified slices", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "demo",
      sliceId: "DEMO-001",
      research: { completedAt: "2026-04-20T00:00:00.000Z", researchRefs: ["research/demo.md"] },
      "domain-model": { completedAt: "2026-04-20T00:00:01.000Z", decisionRefs: ["projects/demo/decisions.md#current-decisions"] },
      prd: { completedAt: "2026-04-20T00:00:02.000Z", prdRef: "PRD-001", parentPrd: "PRD-001" },
      slices: { completedAt: "2026-04-20T00:00:03.000Z", sliceRefs: ["DEMO-001"] },
      tdd: { completedAt: "2026-04-20T00:00:04.000Z", tddEvidence: ["projects/demo/specs/slices/DEMO-001/test-plan.md#red-tests"] },
    };
    const validation = validateForgeWorkflowLedger(ledger);

    const normalized = normalizeForgeValidationForCloseableSlice(validation, {
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: "test-verified",
    });
    expect(normalized.ok).toBe(true);
    expect(normalized.nextPhase).toBeNull();
    expect(normalized.statuses.every((status) => status.completed)).toBe(true);

    const unchanged = normalizeForgeValidationForCloseableSlice(validation, {
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: "code-verified",
    });
    expect(unchanged).toEqual(validation);
  });

  test("isSliceDocsReady requires both plan and test-plan readiness", () => {
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "ready" })).toBe(true);
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "incomplete" })).toBe(false);
  });
});
