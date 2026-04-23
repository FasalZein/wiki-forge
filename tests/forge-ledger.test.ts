import { describe, expect, test } from "bun:test";
import {
  FORGE_PHASES,
  SKIPPABLE_FORGE_PHASES,
  canAdvanceForgePhase,
  isForgePhaseSkippable,
  type ForgeWorkflowLedger,
  validateForgeWorkflowLedger,
} from "../src/protocol/status/workflow-ledger";

describe("forge workflow ledger", () => {
  test("keeps the forge phase chain in canonical order", () => {
    expect(FORGE_PHASES).toEqual(["research", "domain-model", "prd", "slices", "tdd", "verify"]);
  });

  test("reports research as the next missing phase for an empty ledger", () => {
    const validation = validateForgeWorkflowLedger({ project: "wiki-forge", sliceId: "WIKI-FORGE-124" });
    expect(validation.ok).toBe(false);
    expect(validation.nextPhase).toBe("research");
    expect(validation.statuses[0].missing).toContain("research.completedAt");
    expect(validation.statuses[0].missing).toContain("research.researchRefs");
  });

  test("blocks domain-model until research evidence exists", () => {
    const gate = canAdvanceForgePhase(
      {
        project: "wiki-forge",
        sliceId: "WIKI-FORGE-124",
      },
      "domain-model",
    );
    expect(gate.ok).toBe(false);
    expect(gate.blockedBy).toEqual(["research"]);
  });

  test("requires parent PRD linkage before PRD phase can pass", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-124",
      research: { completedAt: "2026-04-17T00:00:00Z", researchRefs: ["research/projects/wiki-forge/redesign.md"] },
      "domain-model": { completedAt: "2026-04-17T00:10:00Z", decisionRefs: ["projects/wiki-forge/decisions.md#redesign"] },
      prd: { completedAt: "2026-04-17T00:20:00Z", prdRef: "PRD-044" },
    };

    const gate = canAdvanceForgePhase(ledger, "prd");
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("prd.parentPrd");
  });

  test("requires TDD evidence before verification can advance", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-124",
      parentPrd: "PRD-044",
      research: { completedAt: "2026-04-17T00:00:00Z", researchRefs: ["research/projects/wiki-forge/redesign.md"] },
      "domain-model": { completedAt: "2026-04-17T00:10:00Z", decisionRefs: ["projects/wiki-forge/decisions.md#redesign"] },
      prd: { completedAt: "2026-04-17T00:20:00Z", prdRef: "PRD-044", parentPrd: "PRD-044" },
      slices: { completedAt: "2026-04-17T00:30:00Z", sliceRefs: ["WIKI-FORGE-124"] },
      tdd: { completedAt: "2026-04-17T00:40:00Z", tddEvidence: [] },
      verify: { completedAt: "2026-04-17T00:50:00Z", verificationCommands: ["bun test", "bun run check"] },
    };

    const gate = canAdvanceForgePhase(ledger, "verify");
    expect(gate.ok).toBe(false);
    expect(gate.blockedBy).toEqual(["tdd"]);
  });

  test("accepts a fully completed harness-agnostic workflow ledger", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-124",
      parentPrd: "PRD-044",
      research: { completedAt: "2026-04-17T00:00:00Z", researchRefs: ["research/projects/wiki-forge/redesign.md"] },
      "domain-model": { completedAt: "2026-04-17T00:10:00Z", decisionRefs: ["projects/wiki-forge/decisions.md#redesign"] },
      prd: { completedAt: "2026-04-17T00:20:00Z", prdRef: "PRD-044", parentPrd: "PRD-044" },
      slices: { completedAt: "2026-04-17T00:30:00Z", sliceRefs: ["WIKI-FORGE-124"] },
      tdd: { completedAt: "2026-04-17T00:40:00Z", tddEvidence: ["bun test tests/forge-ledger.test.ts"] },
      verify: { completedAt: "2026-04-17T00:50:00Z", verificationCommands: ["bun test", "bun run check"] },
    };

    const validation = validateForgeWorkflowLedger(ledger);
    expect(validation.ok).toBe(true);
    expect(validation.nextPhase).toBeNull();
    expect(validation.statuses.every((status) => status.completed)).toBe(true);
  });

  test("exposes the skippable-phase floor: research, domain-model, prd, slices only", () => {
    expect([...SKIPPABLE_FORGE_PHASES].sort()).toEqual(["domain-model", "prd", "research", "slices"]);
    expect(isForgePhaseSkippable("research")).toBe(true);
    expect(isForgePhaseSkippable("domain-model")).toBe(true);
    expect(isForgePhaseSkippable("prd")).toBe(true);
    expect(isForgePhaseSkippable("slices")).toBe(true);
    expect(isForgePhaseSkippable("tdd")).toBe(false);
    expect(isForgePhaseSkippable("verify")).toBe(false);
  });

  test("skipping research treats the phase as completed without evidence", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-197",
      skippedPhases: [
        { phase: "research", reason: "already satisfied by prior refactor", skippedAt: "2026-04-23T18:00:00Z" },
      ],
    };

    const validation = validateForgeWorkflowLedger(ledger);
    const research = validation.statuses.find((status) => status.phase === "research");
    expect(research).toMatchObject({ completed: true, ready: true, missing: [], blockedBy: [] });
    expect(validation.nextPhase).toBe("domain-model");
  });

  test("skipping a phase unblocks subsequent phases in the same ledger", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-197",
      skippedPhases: [
        { phase: "research", reason: "spike", skippedAt: "2026-04-23T18:00:00Z" },
        { phase: "domain-model", reason: "spike", skippedAt: "2026-04-23T18:00:00Z" },
      ],
    };

    const gate = canAdvanceForgePhase(ledger, "prd");
    expect(gate.blockedBy).toEqual([]);
    expect(gate.missing).toContain("prd.completedAt");
  });

  test("skippedPhases composes with workflowProfile full without re-listing prior requirements", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-197",
      workflowProfile: "full",
      parentPrd: "PRD-082",
      skippedPhases: [
        { phase: "research", reason: "spike", skippedAt: "2026-04-23T18:00:00Z" },
        { phase: "domain-model", reason: "spike", skippedAt: "2026-04-23T18:00:00Z" },
      ],
      prd: { completedAt: "2026-04-23T18:10:00Z", prdRef: "PRD-082", parentPrd: "PRD-082" },
      slices: { completedAt: "2026-04-23T18:20:00Z", sliceRefs: ["WIKI-FORGE-197"] },
      tdd: { completedAt: "2026-04-23T18:30:00Z", tddEvidence: ["bun test"] },
      verify: { completedAt: "2026-04-23T18:40:00Z", verificationCommands: ["bun test", "bun run check"] },
    };

    const validation = validateForgeWorkflowLedger(ledger);
    expect(validation.ok).toBe(true);
    expect(validation.nextPhase).toBeNull();
  });

  test("skipping tdd or verify is rejected at the validation layer — floor is not reason-waivable", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-197",
      // @ts-expect-error: intentionally bypass the type floor to prove the validator rejects it
      skippedPhases: [{ phase: "tdd", reason: "trust me", skippedAt: "2026-04-23T18:00:00Z" }],
    };

    const validation = validateForgeWorkflowLedger(ledger);
    const tdd = validation.statuses.find((status) => status.phase === "tdd");
    expect(tdd?.completed).toBe(false);
    expect(tdd?.missing).toContain("tdd.completedAt");
  });

  test("bootstrap profile skips research and domain-model requirements", () => {
    const ledger: ForgeWorkflowLedger = {
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-189",
      workflowProfile: "bootstrap",
      parentPrd: "PRD-080",
      prd: { completedAt: "2026-04-23T00:20:00Z", prdRef: "PRD-080", parentPrd: "PRD-080" },
      slices: { completedAt: "2026-04-23T00:30:00Z", sliceRefs: ["WIKI-FORGE-189"] },
      tdd: { completedAt: "2026-04-23T00:40:00Z", tddEvidence: ["bun test tests/forge-ledger.test.ts"] },
    };

    const validation = validateForgeWorkflowLedger(ledger);
    expect(validation.ok).toBe(false);
    expect(validation.nextPhase).toBe("verify");
    expect(validation.statuses.find((status) => status.phase === "research")).toMatchObject({
      completed: true,
      missing: [],
      blockedBy: [],
    });
    expect(validation.statuses.find((status) => status.phase === "domain-model")).toMatchObject({
      completed: true,
      missing: [],
      blockedBy: [],
    });
  });
});
