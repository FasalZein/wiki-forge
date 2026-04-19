import { describe, expect, test } from "bun:test";
import { TRIAGE_RULES, classifyResumeTriage } from "../src/session/resume-triage";

describe("resume triage priorities", () => {
  test("keeps the declared rule ordering explicit", () => {
    expect(TRIAGE_RULES.map(({ kind, priority }) => ({ kind, priority }))).toEqual([
      { kind: "resume-failed-forge", priority: 10 },
      { kind: "needs-research", priority: 20 },
      { kind: "continue-active-slice", priority: 30 },
      { kind: "start-next-slice", priority: 40 },
      { kind: "plan-next", priority: 50 },
    ]);
  });

  test("resume-failed-forge beats an earlier-phase gate when verify-close evidence exists", () => {
    const triage = classifyResumeTriage({
      project: "demo",
      repo: "/repo",
      base: "HEAD",
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      handoff: {
        lastForgeOk: false,
        lastForgeStep: "verify-slice",
        nextAction: "rerun verify-slice",
        failureSummary: "verify-slice exited 1",
      },
      workflowNextPhase: "research",
      earlyPhase: true,
      verificationLevel: "test-verified",
    });

    expect(triage.kind).toBe("resume-failed-forge");
    expect(triage.command).toContain("wiki forge run demo DEMO-001 --repo /repo --base HEAD");
  });

  test("pre-phase gate beats continue-active-slice when docs are not ready", () => {
    const triage = classifyResumeTriage({
      project: "demo",
      repo: "/repo",
      base: "HEAD",
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      handoff: null,
      workflowNextPhase: "research",
      earlyPhase: true,
      verificationLevel: null,
    });

    expect(triage.kind).toBe("needs-research");
    expect(triage.loadSkill).toBe("/research");
  });
});
