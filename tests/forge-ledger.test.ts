import { describe, expect, test } from "bun:test";
import {
  FORGE_PHASES,
  canAdvanceForgePhase,
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
});
