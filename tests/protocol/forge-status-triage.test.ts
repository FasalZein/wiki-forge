import { describe, expect, test } from "bun:test";
import { buildForgeTriage } from "../../src/forge/status";

describe("forge status triage adapter", () => {
  test("maps pre-implementation workflow phases to shared phase recommendations", () => {
    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: "DEMO-001",
      sliceStatus: "in-progress",
      section: "In Progress",
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: null,
      nextPhase: "grill-with-docs",
    });

    expect(triage.kind).toBe("needs-grill-with-docs");
    expect(triage.loadSkill).toBe("/grill-with-docs");
    expect(triage.command).toContain("wiki forge grill record demo");
    expect(triage.command).toContain("projects/demo/architecture/domain-language.md");
    expect(triage.command).toContain("projects/demo/architecture/context-map.md");
    expect(triage.command).toContain("projects/demo/architecture/contexts/<context>.md");
    expect(triage.command).toContain("projects/demo/adrs/");
    expect(triage.command).toContain("projects/demo/decisions.md");
  });

  test("maps done slices to the next-slice steering action", () => {
    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: null,
      sliceStatus: "done",
      section: "Done",
      canonicalCompletion: true,
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: "test-verified",
      nextPhase: null,
    });

    expect(triage.kind).toBe("completed");
    expect(triage.command).toBe("wiki forge next demo");
  });

  test("does not map docs-only done slices to completed without canonical close evidence", () => {
    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: null,
      sliceStatus: "done",
      section: "Done",
      canonicalCompletion: false,
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: "test-verified",
      nextPhase: null,
    });

    expect(triage.kind).not.toBe("completed");
    expect(triage.command).toContain("wiki forge run demo DEMO-001");
  });
});
