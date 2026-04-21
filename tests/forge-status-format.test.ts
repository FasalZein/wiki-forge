import { describe, expect, test } from "bun:test";
import { compactForgeStatusForJson } from "../src/protocol/forge-status-format";

describe("forge status format helpers", () => {
  test("compactForgeStatusForJson aliases missing to unmet and strips internal context fields", () => {
    const payload = compactForgeStatusForJson({
      project: "demo",
      sliceId: "DEMO-001",
      activeSlice: "DEMO-001",
      recommendedSlice: "DEMO-001",
      planStatus: "ready",
      testPlanStatus: "ready",
      verificationLevel: "code-verified",
      workflow: {
        ledger: {
          project: "demo",
          sliceId: "DEMO-001",
          grill: {
            completedAt: "2026-04-20T00:00:00.000Z",
            decisionRefs: ["projects/demo/decisions.md#current-decisions"],
          },
        },
        validation: {
          ok: false,
          nextPhase: "domain-model",
          statuses: [{
            phase: "domain-model",
            completed: false,
            ready: true,
            missing: ["domain-model.decisionRefs"],
            blockedBy: [],
          }],
        },
      },
      context: {
        id: "DEMO-001",
        title: "status slice",
        section: "In Progress",
        assignee: "codex",
        sliceStatus: "in-progress",
        planStatus: "ready",
        testPlanStatus: "ready",
        dependencies: ["DEMO-000"],
        blockedBy: [],
        taskHubPath: "projects/demo/specs/slices/DEMO-001/index.md",
        planPath: "projects/demo/specs/slices/DEMO-001/plan.md",
        testPlanPath: "projects/demo/specs/slices/DEMO-001/test-plan.md",
        hasSliceDocs: true,
      } as never,
      triage: {
        kind: "needs-domain-model",
        reason: "domain model missing",
        command: "wiki forge status demo DEMO-001",
      },
      steering: {
        lane: "domain-work",
        phase: "domain-model",
        nextCommand: "wiki forge status demo DEMO-001",
        why: "domain model missing",
        loadSkill: "/domain-model",
      },
    });

    expect(payload.workflow.ledger["domain-model"]).toEqual({
      completedAt: "2026-04-20T00:00:00.000Z",
      decisionRefs: ["projects/demo/decisions.md#current-decisions"],
    });
    expect((payload.workflow.ledger as Record<string, unknown>).grill).toBeUndefined();
    expect(payload.workflow.validation.statuses[0].unmet).toEqual(["domain-model.decisionRefs"]);
    expect(payload.context).toEqual({
      id: "DEMO-001",
      title: "status slice",
      section: "In Progress",
      assignee: "codex",
      sliceStatus: "in-progress",
      planStatus: "ready",
      testPlanStatus: "ready",
      dependencies: ["DEMO-000"],
      blockedBy: [],
    });
  });
});
