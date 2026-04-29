import { describe, expect, test } from "bun:test";
import { buildSkillChainPacket, getDefaultSkillChain } from "../../src/forge/lifecycle/skill-chain";
import { isPhaseSkippable } from "../../src/forge/lifecycle/phase";
import { validatePhaseCompletion, validatePhaseTransition } from "../../src/forge/lifecycle/phase-gates";

describe("forge skill chain gates", () => {
  test("phase validator blocks review before verification", () => {
    const gate = validatePhaseTransition({
      completedPhases: ["research", "domain-model", "spec", "slices", "ownership", "implementation", "tdd"],
      requestedPhase: "review",
      reviewPolicy: { required: true },
    });

    expect(gate).toEqual({
      status: "blocked",
      nextRequiredPhase: "verification",
      reason: "phase verification must complete before review",
    });
  });

  test("phase validator blocks close before review when review policy requires it", () => {
    const gate = validatePhaseTransition({
      completedPhases: ["research", "domain-model", "spec", "slices", "ownership", "implementation", "tdd", "verification"],
      requestedPhase: "close",
      reviewPolicy: { required: true },
    });

    expect(gate).toEqual({
      status: "blocked",
      nextRequiredPhase: "review",
      reason: "phase review must complete before close",
    });
  });

  test("review can be policy-optional but tdd verification and close are never skippable", () => {
    const gate = validatePhaseTransition({
      completedPhases: ["research", "domain-model", "spec", "slices", "ownership", "implementation", "tdd", "verification"],
      requestedPhase: "close",
      reviewPolicy: { required: false },
    });

    expect(gate).toEqual({ status: "allowed" });
    expect(isPhaseSkippable("tdd")).toBe(false);
    expect(isPhaseSkippable("verification")).toBe(false);
    expect(isPhaseSkippable("close")).toBe(false);
  });

  test("research/domain/spec/slices can be skipped only with audit reason", () => {
    expect(validatePhaseCompletion({ phase: "research", skipped: true, auditReason: "covered by PRD-090" })).toEqual({ status: "valid" });
    expect(validatePhaseCompletion({ phase: "domain-model", skipped: true, auditReason: "covered by domain decision" })).toEqual({ status: "valid" });
    expect(validatePhaseCompletion({ phase: "spec", skipped: true, auditReason: "pre-existing PRD" })).toEqual({ status: "valid" });
    expect(validatePhaseCompletion({ phase: "slices", skipped: true, auditReason: "pre-existing slices" })).toEqual({ status: "valid" });
    expect(validatePhaseCompletion({ phase: "research", skipped: true })).toEqual({
      status: "invalid",
      reason: "skipped phase research requires an audit reason",
    });
    expect(validatePhaseCompletion({ phase: "tdd", skipped: true, auditReason: "too slow" })).toEqual({
      status: "invalid",
      reason: "phase tdd is not skippable",
    });
  });

  test("skill chain packet names required next skill and phase", () => {
    const packet = buildSkillChainPacket({
      completedPhases: ["research", "domain-model", "spec", "slices", "ownership", "implementation"],
      reviewPolicy: { required: true },
    });

    expect(packet).toEqual({
      nextPhase: "tdd",
      requiredSkill: "/tdd",
      chain: getDefaultSkillChain(),
    });
  });
});
