import { describe, expect, test } from "bun:test";
import { buildForgeTriage } from "../../src/protocol";

describe("forge status triage adapter", () => {
  test("maps pre-implementation workflow phases to shared phase recommendations", () => {
    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: "DEMO-001",
      sliceStatus: "in-progress",
      section: "In Progress",
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: null,
      nextPhase: "domain-model",
    });

    expect(triage.kind).toBe("needs-domain-model");
    expect(triage.loadSkill).toBe("/domain-model");
    expect(triage.command).toContain("projects/demo/decisions.md");
  });

  test("maps done slices to the next-slice steering action", () => {
    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: null,
      sliceStatus: "done",
      section: "Done",
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: "test-verified",
      nextPhase: null,
    });

    expect(triage.kind).toBe("completed");
    expect(triage.command).toBe("wiki forge next demo");
  });
});
