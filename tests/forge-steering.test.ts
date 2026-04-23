import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildForgeSteering, isMaintenanceRepairCommand, renderSteeringPacket } from "../src/protocol/steering/packet";
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

function steeringLines(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => /^- (lane|phase|load-skill|next|why):/u.test(line));
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
      targetCanonicalCompletion: true,
    });
    expect(completedDoneSlice.kind).toBe("completed");

    const docsOnlyDoneSlice = classifyWorkflowSteeringTriage({
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
      targetCanonicalCompletion: false,
    });
    expect(docsOnlyDoneSlice.kind).toBe("open-slice");

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

    const verifyGateSteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "close-slice",
        reason: "verification level is missing",
        command: "wiki forge run demo DEMO-001 --repo /repo",
      },
      nextPhase: "verify",
      verificationLevel: null,
    });
    expect(verifyGateSteering.lane).toBe("implementation-work");
    expect(verifyGateSteering.loadSkill).toBe("/desloppify");

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

  test("maintenance repair command detection parses wiki subcommands", () => {
    expect(isMaintenanceRepairCommand("wiki checkpoint demo --repo /repo")).toBe(true);
    expect(isMaintenanceRepairCommand("wiki   checkpoint demo --repo /repo")).toBe(true);
    expect(isMaintenanceRepairCommand("wiki forge run demo DEMO-001 --repo /repo")).toBe(false);
    expect(isMaintenanceRepairCommand("wiki-checkpoint demo --repo /repo")).toBe(false);
  });

  test("iteration contract carries the full forge chain and conditional torpathy", () => {
    const steering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "needs-domain-model",
        reason: "domain model evidence is incomplete",
        command: "/domain-model",
        loadSkill: "/domain-model",
      },
      nextPhase: "domain-model",
      verificationLevel: null,
      designPressure: true,
    });

    expect(steering.iterationContract.designPressure).toBe("flagged");
    expect(steering.iterationContract.requiredSkill).toBe("/domain-model");
    expect(steering.iterationContract.remainingChain.slice(0, 4)).toEqual([
      "domain-model",
      "torpathy",
      "write-a-prd",
      "prd-to-slices",
    ]);
    expect(steering.iterationContract.qualityGates).toEqual(["verify", "desloppify"]);
    expect(steering.iterationContract.reviewGates).toEqual(["review", "closeout", "gate"]);
  });

  test("subagent policy stays optional during initial planning phases", () => {
    const planningPhases = ["research", "domain-model", "prd", "slices"] as const;

    for (const nextPhase of planningPhases) {
      const steering = buildForgeSteering({
        project: "demo",
        sliceId: "DEMO-001",
        triage: {
          kind: "needs-research",
          reason: "planning phase is incomplete",
          command: "/research",
          loadSkill: "/research",
        },
        nextPhase,
        verificationLevel: null,
      });

      expect(steering.iterationContract.subagentPolicy.stage).toBe("planning-linear");
      expect(steering.iterationContract.subagentPolicy.strategyEvaluationRequired).toBe(false);
      expect(steering.iterationContract.subagentPolicy.implementationStrategies).toEqual(["linear"]);
      expect(steering.iterationContract.subagentPolicy.requiredSubagents).toEqual([]);
      expect(steering.iterationContract.subagentPolicy.iterationMode).toBe("slice-phase-contract");
      expect(JSON.stringify(steering.iterationContract.subagentPolicy)).not.toContain("ralph");
    }
  });

  test("tdd steering requires subagent-vs-linear evaluation before edits", () => {
    const steering = buildForgeSteering({
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

    expect(steering.iterationContract.subagentPolicy.stage).toBe("implementation-evaluate");
    expect(steering.iterationContract.subagentPolicy.strategyEvaluationRequired).toBe(true);
    expect(steering.iterationContract.subagentPolicy.implementationStrategies).toEqual(["subagent-driven", "linear"]);
    expect(steering.iterationContract.subagentPolicy.conflictChecks).toEqual(expect.arrayContaining([
      "overlapping-file-ownership",
      "shared-state-or-migration-risk",
      "coordination-cost-exceeds-slice-size",
    ]));
    expect(steering.iterationContract.subagentPolicy.requiredSubagents).toEqual([
      {
        role: "strategy-evaluator",
        count: 1,
        requiredWhen: "before implementation edits",
        artifact: "subagent-vs-linear decision with conflict rationale",
      },
    ]);
  });

  test("verify steering requires multiple GPT-5.5 review subagents and gap handling", () => {
    const steering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "close-slice",
        reason: "verification level is missing",
        command: "wiki forge run demo DEMO-001 --repo /repo",
      },
      nextPhase: "verify",
      verificationLevel: null,
    });

    expect(steering.iterationContract.subagentPolicy.stage).toBe("review-multi-pass");
    expect(steering.iterationContract.subagentPolicy.reviewPasses).toEqual({
      minimum: 2,
      model: "gpt-5.5",
      requiredWhen: "after implementation changes before closeout",
      gapHandling: "fix-now-or-record-follow-up-refactor",
    });
    expect(steering.iterationContract.subagentPolicy.requiredSubagents).toEqual([
      {
        role: "reviewer",
        count: 2,
        model: "gpt-5.5",
        requiredWhen: "after implementation changes before closeout",
        artifact: "blockers, regression risks, and residual refactor gaps",
      },
    ]);
  });

  test("text steering renders subagent policy without ralph-loop routing", () => {
    const steering = buildForgeSteering({
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

    const lines = renderSteeringPacket(steering);
    const text = lines.join("\n");
    expect(text).toContain("subagent-policy: evaluate before edits; strategies=subagent|linear");
    expect(text).toContain("subagent-artifact: strategy decision; conflicts=file/state/cost/context");
    expect(text).not.toContain("ralph");
    expect(JSON.stringify(steering.iterationContract.subagentPolicy)).not.toContain("ralph");
  });

  test("verify and complete review subagent policies have JSON and text parity", () => {
    const verifySteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "close-slice",
        reason: "verification level is missing",
        command: "wiki forge run demo DEMO-001 --repo /repo",
      },
      nextPhase: "verify",
      verificationLevel: null,
    });
    const completeSteering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage: {
        kind: "completed",
        reason: "slice is complete",
        command: "wiki forge next demo",
      },
      nextPhase: null,
      verificationLevel: "test-verified",
    });

    for (const steering of [verifySteering, completeSteering]) {
      const policy = steering.iterationContract.subagentPolicy;
      const text = renderSteeringPacket(steering).join("\n");
      expect(policy.stage).toBe("review-multi-pass");
      expect(policy.reviewPasses.minimum).toBe(2);
      expect(policy.reviewPasses.model).toBe("gpt-5.5");
      expect(text).toContain(`review-subagents: ${policy.reviewPasses.minimum} x ${policy.reviewPasses.model}; gaps=fix-or-follow-up`);
      expect(policy.reviewPasses.gapHandling).toBe("fix-now-or-record-follow-up-refactor");
      expect(text).toContain("subagent-artifact: blockers/risks/refactor-gaps");
      expect(text).not.toContain("ralph");
      expect(JSON.stringify(policy)).not.toContain("ralph");
    }
  });

  test("resume, forge next, and forge status share one iteration contract", () => {
    const { repo, env } = setupRepo("wf199contract");

    const next = runWiki(["forge", "next", "wf199contract", "--repo", repo, "--json"], env);
    const status = runWiki(["forge", "status", "wf199contract", "WF199CONTRACT-001", "--repo", repo, "--json"], env);
    const resume = runWiki(["resume", "wf199contract", "--repo", repo, "--json"], env);
    expect(next.exitCode).toBe(0);
    expect(status.exitCode).toBe(0);
    expect(resume.exitCode).toBe(0);

    const nextContract = next.json<{ steering: { iterationContract: unknown } }>().steering.iterationContract;
    const statusContract = status.json<{ steering: { iterationContract: unknown } }>().steering.iterationContract;
    const resumeContract = resume.json<{ steering: { iterationContract: unknown } }>().steering.iterationContract;
    expect(nextContract).toEqual(statusContract);
    expect(resumeContract).toEqual(statusContract);

    const text = runWiki(["forge", "next", "wf199contract", "--repo", repo], env);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("- iteration-contract: research -> domain-model -> write-a-prd -> prd-to-slices -> tdd -> verify -> desloppify -> review -> closeout -> gate");
    expect(text.stdout.toString()).toContain("- quality-gates: verify -> desloppify");
    expect(text.stdout.toString()).toContain("- review-gates: review -> closeout -> gate");
    expect(text.stdout.toString()).not.toContain("- subagent-policy: planning-linear");
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

  test("forge status requires a research bridge before advancing from research to domain-model", () => {
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

    expect(payload.workflow.validation.nextPhase).toBe("research");
    expect(payload.steering.phase).toBe("research");
    expect(payload.steering.loadSkill).toBe("/research");
  });

  test("steering output is stable when the forge skill body is reduced to a stub", () => {
    const { repo, env } = setupRepo("wf197stub");
    const skillDir = join(repo, "skills", "forge");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: forge\ndescription: verbose fixture\n---\n\n# Forge\n\nLong local skill body that should not affect CLI steering.\n",
      "utf8",
    );

    const beforeNext = runWiki(["forge", "next", "wf197stub"], env);
    const beforeStatus = runWiki(["forge", "status", "wf197stub", "WF197STUB-001", "--json"], env);
    const beforeResume = runWiki(["resume", "wf197stub", "--repo", repo, "--json"], env);
    expect(beforeNext.exitCode).toBe(0);
    expect(beforeStatus.exitCode).toBe(0);
    expect(beforeResume.exitCode).toBe(0);

    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: forge\ndescription: stub\n---\n\n# Forge\n\nUse `wiki forge next|run|status`.\n",
      "utf8",
    );

    const afterNext = runWiki(["forge", "next", "wf197stub"], env);
    const afterStatus = runWiki(["forge", "status", "wf197stub", "WF197STUB-001", "--json"], env);
    const afterResume = runWiki(["resume", "wf197stub", "--repo", repo, "--json"], env);
    expect(afterNext.exitCode).toBe(0);
    expect(afterStatus.exitCode).toBe(0);
    expect(afterResume.exitCode).toBe(0);

    expect(steeringLines(afterNext.stdout.toString())).toEqual(steeringLines(beforeNext.stdout.toString()));
    expect(afterStatus.json<{ steering: unknown }>().steering).toEqual(beforeStatus.json<{ steering: unknown }>().steering);
    expect(afterResume.json<{ steering: unknown }>().steering).toEqual(beforeResume.json<{ steering: unknown }>().steering);
  });
});
