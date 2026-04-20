import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectTaskDocState } from "../src/hierarchy";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("task doc readiness", () => {
  test("detectTaskDocState requires status ready even when the body is filled", async () => {
    const { vault } = setupPassingRepo();
    const docPath = join(vault, "draft-plan.md");
    writeFileSync(
      docPath,
      "---\ntitle: Draft Plan\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-19\nstatus: draft\n---\n\n# Draft Plan\n\n## Scope\n\n- finish implementation\n\n## Acceptance Criteria\n\n- [ ] covered\n",
      "utf8",
    );

    expect(await detectTaskDocState(docPath)).toBe("incomplete");

    writeFileSync(docPath, readFileSync(docPath, "utf8").replace("status: draft", "status: ready"), "utf8");
    expect(await detectTaskDocState(docPath)).toBe("ready");
  });

  test("detectTaskDocState keeps scaffold placeholders incomplete even when status is ready", async () => {
    const { vault } = setupPassingRepo();
    const planPath = join(vault, "placeholder-plan.md");
    const testPlanPath = join(vault, "placeholder-test-plan.md");

    writeFileSync(
      planPath,
      "---\ntitle: Placeholder Plan\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# Plan\n\n## Scope\n\n- PRD-001 demo\n\n## Vertical Slice\n\n1. (fill in during TDD)\n2. (fill in during TDD)\n3. (fill in during TDD)\n\n## Acceptance Criteria\n\n- [ ] implement requirements from PRD-001 demo\n",
      "utf8",
    );
    writeFileSync(
      testPlanPath,
      "---\ntitle: Placeholder Test Plan\ntype: spec\nspec_kind: test-plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# Test Plan\n\n## Red Tests\n\n- [ ] implement requirements from PRD-001 demo\n\n## Green Criteria\n\n- [ ] All red tests pass\n- [ ] No regressions in existing test suite\n\n## Refactor Checks\n\n- [ ] confirm no regressions in adjacent code paths\n",
      "utf8",
    );

    expect(await detectTaskDocState(planPath)).toBe("incomplete");
    expect(await detectTaskDocState(testPlanPath)).toBe("incomplete");
  });

  test("forge status keeps filled draft docs out of ready state", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "wf153"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "wf153");
    expect(runWiki(["create-issue-slice", "wf153", "readiness slice"], env).exitCode).toBe(0);

    const sliceDir = join(vault, "projects", "wf153", "specs", "slices", "WF153-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF153-001\ntype: spec\nspec_kind: plan\nproject: wf153\ntask_id: WF153-001\nupdated: 2026-04-19\nstatus: draft\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n\n## Acceptance Criteria\n\n- [ ] done\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF153-001\ntype: spec\nspec_kind: test-plan\nproject: wf153\ntask_id: WF153-001\nupdated: 2026-04-19\nstatus: draft\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n\n## Verification Commands\n\n```bash\nbun test\n```\n",
      "utf8",
    );

    const status = runWiki(["forge", "status", "wf153", "WF153-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout.toString());
    expect(payload.planStatus).toBe("incomplete");
    expect(payload.testPlanStatus).toBe("incomplete");
    expect(payload.workflow.validation.nextPhase).toBe("research");
    expect(payload.steering.loadSkill).toBe("/research");
  });

  test("resume does not route scaffold-ready slices into forge run", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "wf153resume"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "wf153resume");
    expect(runWiki(["create-issue-slice", "wf153resume", "readiness slice"], env).exitCode).toBe(0);

    const sliceDir = join(vault, "projects", "wf153resume", "specs", "slices", "WF153RESUME-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF153RESUME-001\ntype: spec\nspec_kind: plan\nproject: wf153resume\ntask_id: WF153RESUME-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- PRD-001 readiness slice\n\n## Vertical Slice\n\n1. (fill in during TDD)\n2. (fill in during TDD)\n3. (fill in during TDD)\n\n## Acceptance Criteria\n\n- [ ] implement requirements from PRD-001 readiness slice\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF153RESUME-001\ntype: spec\nspec_kind: test-plan\nproject: wf153resume\ntask_id: WF153RESUME-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [ ] implement requirements from PRD-001 readiness slice\n\n## Green Criteria\n\n- [ ] All red tests pass\n- [ ] No regressions in existing test suite\n\n## Refactor Checks\n\n- [ ] confirm no regressions in adjacent code paths\n",
      "utf8",
    );

    const resume = runWiki(["resume", "wf153resume", "--repo", repo, "--json"], env);
    expect(resume.exitCode).toBe(0);
    const payload = JSON.parse(resume.stdout.toString());
    expect(payload.nextTask.id).toBe("WF153RESUME-001");
    expect(payload.workflowNextPhase).toBe("research");
    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.loadSkill).toBe("/research");
    expect(payload.steering.nextCommand).not.toContain("wiki forge run wf153resume WF153RESUME-001");
  });
});
