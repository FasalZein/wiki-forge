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

  test("earlier workflow gates beat stale failed-forge breadcrumbs", () => {
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
      verificationLevel: "test-verified",
    });

    expect(triage.kind).toBe("needs-research");
    expect(triage.command).not.toContain("wiki forge run demo DEMO-001 --repo /repo --base HEAD");
  });

  test("resume-failed-forge is still used once the workflow is already in verify", () => {
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
      workflowNextPhase: "verify",
      verificationLevel: "test-verified",
    });

    expect(triage.kind).toBe("resume-failed-forge");
    expect(triage.command).toBe("rerun verify-slice");
  });

  test("verify-phase maintenance breadcrumbs preserve the concrete repair command", () => {
    const triage = classifyResumeTriage({
      project: "demo",
      repo: "/repo",
      base: "HEAD",
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      handoff: {
        lastForgeOk: false,
        lastForgeStep: "checkpoint",
        nextAction: "wiki checkpoint demo --repo /repo --base HEAD --slice-local --slice-id DEMO-001",
        failureSummary: "close failed at checkpoint",
      },
      workflowNextPhase: "verify",
      verificationLevel: "code-verified",
    });

    expect(triage.kind).toBe("resume-failed-forge");
    expect(triage.command).toBe("wiki checkpoint demo --repo /repo --base HEAD --slice-local --slice-id DEMO-001");
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
      verificationLevel: null,
    });

    expect(triage.kind).toBe("needs-research");
    expect(triage.loadSkill).toBe("/research");
  });

  test("failed checkpoint breadcrumb does not outrank the current phase gate when verification is missing", () => {
    const triage = classifyResumeTriage({
      project: "demo",
      repo: "/repo",
      base: "HEAD",
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      handoff: {
        lastForgeOk: false,
        lastForgeStep: "checkpoint",
        nextAction: "rerun checkpoint",
        failureSummary: "checkpoint found 4 stale page(s)",
      },
      workflowNextPhase: "research",
      verificationLevel: null,
    });

    expect(triage.kind).toBe("needs-research");
    expect(triage.loadSkill).toBe("/research");
    expect(triage.command).not.toContain("wiki forge run demo DEMO-001");
  });
});
