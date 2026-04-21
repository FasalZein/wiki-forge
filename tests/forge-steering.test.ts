import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildForgeSteering } from "../src/lib/forge-steering";
import { classifyWorkflowSteeringTriage } from "../src/protocol/steering-triage";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupRepo(project: string) {
  const vault = tempDir(`${project}-vault`);
  const repo = tempDir(`${project}-repo`);
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", project], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, project);
  expect(runWiki(["create-issue-slice", project, "auth slice"], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("WIKI-FORGE-149 steering packet", () => {
  test("shared triage boundary keeps phase gates ahead of forge-run actions", () => {
    const researchGate = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: "HEAD",
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      workflowNextPhase: "research",
      verificationLevel: "test-verified",
    });

    expect(researchGate.kind).toBe("needs-research");
    expect(researchGate.command).not.toContain("wiki forge run demo DEMO-001");

    const verifyRecovery = classifyWorkflowSteeringTriage({
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

    expect(verifyRecovery.kind).toBe("resume-failed-forge");
    expect(verifyRecovery.command).toBe("rerun verify-slice");
  });

  test("shared triage boundary owns close and backlog continuation decisions", () => {
    const closeVerifiedActive = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: undefined,
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      targetTask: { id: "DEMO-001", planStatus: "ready", testPlanStatus: "ready", sliceStatus: "in-progress", section: "In Progress" },
      workflowNextPhase: null,
      verificationLevel: "test-verified",
      targetSliceStatus: "in-progress",
      targetSection: "In Progress",
    });
    expect(closeVerifiedActive.kind).toBe("close-slice");

    const openVerifiedInactive = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: undefined,
      activeTask: null,
      nextTask: { id: "DEMO-002" },
      targetTask: { id: "DEMO-001", planStatus: "ready", testPlanStatus: "ready", sliceStatus: "draft", section: "Todo" },
      workflowNextPhase: null,
      verificationLevel: "test-verified",
      targetSliceStatus: "draft",
      targetSection: "Todo",
    });
    expect(openVerifiedInactive.kind).toBe("open-slice");

    const completedDoneSlice = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: undefined,
      activeTask: null,
      nextTask: null,
      targetTask: { id: "DEMO-001", planStatus: "ready", testPlanStatus: "ready", sliceStatus: "done", section: "Done" },
      workflowNextPhase: null,
      verificationLevel: "test-verified",
      targetSliceStatus: "done",
      targetSection: "Done",
    });
    expect(completedDoneSlice.kind).toBe("completed");

    const continueActive = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: undefined,
      activeTask: { id: "DEMO-001" },
      nextTask: { id: "DEMO-002" },
      workflowNextPhase: null,
      verificationLevel: null,
    });
    expect(continueActive.kind).toBe("continue-active-slice");

    const startNext = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: undefined,
      activeTask: null,
      nextTask: { id: "DEMO-002" },
      workflowNextPhase: null,
      verificationLevel: null,
    });
    expect(startNext.kind).toBe("start-next-slice");

    const planNext = classifyWorkflowSteeringTriage({
      project: "demo",
      repo: "/repo",
      base: undefined,
      activeTask: null,
      nextTask: null,
      workflowNextPhase: null,
      verificationLevel: null,
    });
    expect(planNext.kind).toBe("plan-next");
  });

  test("shared steering packet maps triage outcomes into operator lanes", () => {
    const researchSteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "needs-research",
        reason: "research is incomplete",
        command: "/research",
        loadSkill: "/research",
      },
      nextPhase: "research",
      verificationLevel: null,
    });
    expect(researchSteering.lane).toBe("domain-work");
    expect(researchSteering.loadSkill).toBe("/research");

    const tddSteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "needs-tdd",
        reason: "tdd is incomplete",
        command: "update test-plan",
        loadSkill: "/tdd",
      },
      nextPhase: "tdd",
      verificationLevel: null,
    });
    expect(tddSteering.lane).toBe("implementation-work");
    expect(tddSteering.loadSkill).toBe("/tdd");

    const verifyCloseSteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "open-slice",
        reason: "slice is not active",
        command: "wiki forge run demo DEMO-001 --repo /repo",
      },
      nextPhase: null,
      verificationLevel: "test-verified",
    });
    expect(verifyCloseSteering.lane).toBe("verify-close");
    expect(verifyCloseSteering.loadSkill).toBeUndefined();

    const maintenanceRecoverySteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "resume-failed-forge",
        reason: "verify failed at closeout",
        command: "wiki closeout demo --repo /repo --base HEAD --slice-local --slice-id DEMO-001",
      },
      nextPhase: "verify",
      verificationLevel: "test-verified",
    });
    expect(maintenanceRecoverySteering.lane).toBe("maintenance-refresh");
    expect(maintenanceRecoverySteering.nextCommand).toContain("wiki closeout demo");
  });

  test("resume json includes shared steering for domain-work", () => {
    const { repo, env } = setupRepo("wf149resume");
    expect(runWiki(["forge", "start", "wf149resume", "WF149RESUME-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["resume", "wf149resume", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.phase).toBe("research");
    expect(payload.steering.loadSkill).toBe("/research");
  });

  test("forge status json keeps docs-ready but research-incomplete slice in domain-work", () => {
    const { vault, env } = setupRepo("wf149status");
    const sliceDir = join(vault, "projects", "wf149status", "specs", "slices", "WF149STATUS-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149STATUS-001\ntype: spec\nspec_kind: plan\nproject: wf149status\ntask_id: WF149STATUS-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149STATUS-001\ntype: spec\nspec_kind: test-plan\nproject: wf149status\ntask_id: WF149STATUS-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n",
      "utf8",
    );

    const result = runWiki(["forge", "status", "wf149status", "WF149STATUS-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.phase).toBe("research");
    expect(payload.steering.loadSkill).toBe("/research");
    expect(payload.steering.nextCommand).not.toContain("wiki forge run wf149status WF149STATUS-001");
  });

  test("forge next text leads with the shared pre-implementation steering packet", () => {
    const { vault, env } = setupRepo("wf149next");
    const sliceDir = join(vault, "projects", "wf149next", "specs", "slices", "WF149NEXT-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149NEXT-001\ntype: spec\nspec_kind: plan\nproject: wf149next\ntask_id: WF149NEXT-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149NEXT-001\ntype: spec\nspec_kind: test-plan\nproject: wf149next\ntask_id: WF149NEXT-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n",
      "utf8",
    );

    const result = runWiki(["forge", "next", "wf149next"], env);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();

    expect(output).toContain("- lane: domain-work");
    expect(output).toContain("- load-skill: /research");
    expect(output).not.toContain("- next: wiki forge run wf149next WF149NEXT-001 --repo <path>");
  });

  test("forge next keeps placeholder-ready slices in the pre-implementation lane", () => {
    const { vault, env } = setupRepo("wf149placeholder");
    const sliceDir = join(vault, "projects", "wf149placeholder", "specs", "slices", "WF149PLACEHOLDER-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149PLACEHOLDER-001\ntype: spec\nspec_kind: plan\nproject: wf149placeholder\ntask_id: WF149PLACEHOLDER-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- PRD-001 placeholder slice\n\n## Vertical Slice\n\n1. (fill in during TDD)\n2. (fill in during TDD)\n3. (fill in during TDD)\n\n## Acceptance Criteria\n\n- [ ] implement requirements from PRD-001 placeholder slice\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149PLACEHOLDER-001\ntype: spec\nspec_kind: test-plan\nproject: wf149placeholder\ntask_id: WF149PLACEHOLDER-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [ ] implement requirements from PRD-001 placeholder slice\n\n## Green Criteria\n\n- [ ] All red tests pass\n- [ ] No regressions in existing test suite\n\n## Refactor Checks\n\n- [ ] confirm no regressions in adjacent code paths\n",
      "utf8",
    );

    const result = runWiki(["forge", "next", "wf149placeholder", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.targetSlice).toBe("WF149PLACEHOLDER-001");
    expect(payload.planStatus).toBe("incomplete");
    expect(payload.testPlanStatus).toBe("incomplete");
    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.nextCommand).not.toContain("wiki forge run wf149placeholder WF149PLACEHOLDER-001");
  });

  test("forge status advances to domain-model when the parent PRD already links prior research", () => {
    const { vault, env } = setupRepo("wf149prior");
    const sliceDir = join(vault, "projects", "wf149prior", "specs", "slices", "WF149PRIOR-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149PRIOR-001\ntype: spec\nspec_kind: plan\nproject: wf149prior\ntask_id: WF149PRIOR-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149PRIOR-001\ntype: spec\nspec_kind: test-plan\nproject: wf149prior\ntask_id: WF149PRIOR-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n",
      "utf8",
    );
    const hubPath = join(sliceDir, "index.md");
    const hub = readFileSync(hubPath, "utf8");
    writeFileSync(
      hubPath,
      hub.replace("task_id: WF149PRIOR-001\n", "task_id: WF149PRIOR-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\n"),
      "utf8",
    );

    const prdsDir = join(vault, "projects", "wf149prior", "specs", "prds");
    mkdirSync(prdsDir, { recursive: true });
    writeFileSync(
      join(prdsDir, "PRD-001-auth-flow.md"),
      "---\ntitle: PRD-001 auth flow\ntype: spec\nspec_kind: prd\nproject: wf149prior\nprd_id: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-19\nstatus: draft\n---\n\n# PRD-001\n\n## Prior Research\n\n- [[research/wf149prior/_overview]]\n- [[projects/wf149prior/architecture/reviews/auth-flow-audit]]\n\n## Child Slices\n\n- WF149PRIOR-001\n",
      "utf8",
    );

    const result = runWiki(["forge", "status", "wf149prior", "WF149PRIOR-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.workflow.validation.nextPhase).toBe("domain-model");
    expect(payload.steering.phase).toBe("domain-model");
    expect(payload.steering.loadSkill).toBe("/domain-model");
  });
});
