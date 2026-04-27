import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki forge thin surface", () => {
  test("default help presents wiki as a standalone second-brain surface and keeps forge optional", () => {
    const result = runWiki(["help"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("wiki = second brain / memory");
    expect(output).toContain("forge = optional workflow layer");
    expect(output).toContain("wiki help --all");
    expect(output).toContain("wiki ask <project> <question...>");
    expect(output).toContain("wiki search [--hybrid] <query...>");
    expect(output).toContain("wiki query [--expand] <query...>");
    expect(output).toContain("wiki qmd-status");
    expect(output).toContain("wiki research file <topic> --project <project> <title>");
    expect(output).toContain("wiki scaffold-project <project>");
    expect(output).toContain("wiki summary <project>");
    expect(output).not.toContain("Agent Surface");
    expect(output).not.toContain("wiki forge plan");
    expect(output).not.toContain("wiki forge run");
    expect(output).not.toContain("wiki forge next");
    expect(output).not.toContain("Internal / Repair");
    expect(output).not.toContain("wiki forge start");
    expect(output).not.toContain("wiki forge check");
  });

  test("help --all exposes the full catalog including forge", () => {
    const result = runWiki(["help", "--all"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("Full command catalog:");
    expect(output).toContain("Session:");
    expect(output).toContain("Internal / Repair");
    expect(output).toContain("wiki forge start");
    expect(output).toContain("wiki forge status");
  });

  test("forge run chains check then close in a single pass", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "runproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "runproj");
    expect(runWiki(["create-issue-slice", "runproj", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "runproj", "specs", "slices", "RUNPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "runproj", "specs", "slices", "RUNPROJ-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: RUNPROJ-001 payments slice\ntype: spec\nspec_kind: plan\nproject: runproj\ntask_id: RUNPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# RUNPROJ-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: RUNPROJ-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: runproj\ntask_id: RUNPROJ-001\nupdated: 2026-04-13\nstatus: current\nverification_level: test-verified\n---\n\n# RUNPROJ-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "runproj", "specs/slices/RUNPROJ-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "runproj", "RUNPROJ-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const status = runWiki(["forge", "status", "runproj", "RUNPROJ-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout.toString());
    expect(statusJson.workflow.validation.ok).toBe(true);
    expect(statusJson.workflow.validation.nextPhase).toBeNull();
    expect(statusJson.workflow.validation.statuses.every((step: { completed: boolean }) => step.completed)).toBe(true);

    const run = runWiki(["forge", "run", "runproj", "RUNPROJ-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const json = JSON.parse(run.stdout.toString());
    expect(json.check.ok).toBe(true);
    expect(json.close.ok).toBe(true);
    expect(json.check.phase).toBe("close");
    expect(json.close.phase).toBe("verify");

    const backlog = JSON.parse(runWiki(["backlog", "runproj", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("RUNPROJ-001");
  });

  test("can start, inspect, check, and close a clean slice through wiki forge", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md");
    const testPlanPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    const start = runWiki(["forge", "start", "gated", "GATED-001", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(start.exitCode).toBe(0);
    expect(JSON.parse(start.stdout.toString()).status).toBe("in-progress");

    const status = runWiki(["forge", "status", "gated", "GATED-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout.toString());
    expect(statusJson.context.id).toBe("GATED-001");
    expect(statusJson.triage.kind).toBe("needs-research");
    expect(statusJson.steering.lane).toBe("domain-work");
    expect(statusJson.triage.command).not.toContain("wiki forge run gated GATED-001");
    expect(Array.isArray(statusJson.workflow.validation.statuses)).toBe(true);

    const check = runWiki(["forge", "check", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(check.exitCode).toBe(0);
    const checkJson = JSON.parse(check.stdout.toString());
    expect(checkJson.pipeline.ok).toBe(true);
    expect(checkJson.pipeline.phase).toBe("close");
    expect(checkJson.pipeline.steps.map((step: { id: string }) => step.id)).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);

    const close = runWiki(["forge", "close", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(close.exitCode).toBe(0);
    const closeJson = JSON.parse(close.stdout.toString());
    expect(closeJson.pipeline.ok).toBe(true);
    expect(closeJson.pipeline.phase).toBe("verify");
    expect(closeJson.pipeline.steps.map((step: { id: string }) => step.id)).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);

    const backlog = JSON.parse(runWiki(["backlog", "gated", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("GATED-001");
    expect(readFileSync(testPlanPath, "utf8")).toContain("verification_commands:");
  });

  test("forge status triage returns completed for a done slice and compacts JSON context", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "triageproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "triageproj");
    expect(runWiki(["create-issue-slice", "triageproj", "done slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "triageproj", "specs", "slices", "TRIAGEPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "triageproj", "specs", "slices", "TRIAGEPROJ-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: TRIAGEPROJ-001 done slice\ntype: spec\nspec_kind: plan\nproject: triageproj\ntask_id: TRIAGEPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# TRIAGEPROJ-001 done slice\n\n## Scope\n\n- Done already\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: TRIAGEPROJ-001 done slice\ntype: spec\nspec_kind: test-plan\nproject: triageproj\ntask_id: TRIAGEPROJ-001\nupdated: 2026-04-13\nstatus: current\nverification_level: test-verified\nverification_commands:\n  - command: bun test tests/payments.test.ts\nverified_against: HEAD\n---\n\n# TRIAGEPROJ-001 done slice\n\n## Red Tests\n\n- [x] Done.\n", "utf8");
    expect(runWiki(["bind", "triageproj", "specs/slices/TRIAGEPROJ-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "triageproj", "TRIAGEPROJ-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["close-slice", "triageproj", "TRIAGEPROJ-001", "--repo", repo, "--base", "HEAD~1"], env).exitCode).toBe(0);

    const status = runWiki(["forge", "status", "triageproj", "TRIAGEPROJ-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const json = JSON.parse(status.stdout.toString());
    expect(json.triage.kind).toBe("completed");
    expect(json.triage.command).toContain("forge next");
    expect(json.context.id).toBe("TRIAGEPROJ-001");
    expect(json.context).not.toHaveProperty("taskHubPath");
    expect(json.context).not.toHaveProperty("hasSliceDocs");
  });

  test("forge status keeps docs-only done slices on the close path until canonical completion is stamped", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "triagepending"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "triagepending");
    expect(runWiki(["create-issue-slice", "triagepending", "pending done slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "triagepending", "specs", "slices", "TRIAGEPENDING-001", "plan.md");
    const testPlanPath = join(vault, "projects", "triagepending", "specs", "slices", "TRIAGEPENDING-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: TRIAGEPENDING-001 pending done slice\ntype: spec\nspec_kind: plan\nproject: triagepending\ntask_id: TRIAGEPENDING-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# TRIAGEPENDING-001 pending done slice\n\n## Scope\n\n- Done already\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: TRIAGEPENDING-001 pending done slice\ntype: spec\nspec_kind: test-plan\nproject: triagepending\ntask_id: TRIAGEPENDING-001\nupdated: 2026-04-13\nstatus: current\nverification_level: test-verified\nverification_commands:\n  - command: bun test tests/payments.test.ts\nverified_against: HEAD\n---\n\n# TRIAGEPENDING-001 pending done slice\n\n## Red Tests\n\n- [x] Done.\n", "utf8");

    const indexPath = join(vault, "projects", "triagepending", "specs", "slices", "TRIAGEPENDING-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, raw.replace("status: draft", "status: done\ncompleted_at: 2026-04-20T00:00:00.000Z"), "utf8");

    const status = runWiki(["forge", "status", "triagepending", "TRIAGEPENDING-001", "--repo", repo, "--json"], env);
    expect(status.exitCode).toBe(0);
    const json = JSON.parse(status.stdout.toString());
    expect(json.triage.kind).not.toBe("completed");
    expect(json.triage.command).toContain("wiki forge run triagepending TRIAGEPENDING-001 --repo");
  });

  test("forge status without a slice id uses the recommended slice when one exists", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "statusproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "statusproj");
    expect(runWiki(["create-issue-slice", "statusproj", "payments slice"], env).exitCode).toBe(0);

    const status = runWiki(["forge", "status", "statusproj", "--json"], env);
    expect(status.exitCode).toBe(0);
    const json = JSON.parse(status.stdout.toString());
    expect(json.sliceId).toBe("STATUSPROJ-001");
    expect(json.recommendedSlice).toBe("STATUSPROJ-001");
    expect(json.triage.kind).toBe("needs-research");
  });

  test("forge status without any slice returns structured no-active output", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "emptystatus"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "emptystatus");

    const status = runWiki(["forge", "status", "emptystatus", "--json"], env);
    expect(status.exitCode).toBe(0);
    const json = JSON.parse(status.stdout.toString());
    expect(json.project).toBe("emptystatus");
    expect(json.sliceId).toBeNull();
    expect(json.activeSlice).toBeNull();
    expect(json.recommendedSlice).toBeNull();
    expect(json.triage.kind).toBe("plan-next");
  });

  test("forge plan scaffolds feature, prd, slice, and starts the slice", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "newproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "newproj");

    const plan = runWiki(["forge", "plan", "newproj", "Billing", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);
    const out = plan.stdout.toString();
    expect(out).toContain("created feature FEAT-001");
    expect(out).toContain("created prd PRD-001");
    expect(out).toContain("created slice NEWPROJ-001");

    const backlog = JSON.parse(runWiki(["backlog", "newproj", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("NEWPROJ-001");
  });

  test("forge plan auto-fills plan.md and test-plan.md but keeps scaffold placeholders incomplete", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "newproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "newproj");

    const plan = runWiki(["forge", "plan", "newproj", "Billing", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);

    const planPath = join(vault, "projects", "newproj", "specs", "slices", "NEWPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "newproj", "specs", "slices", "NEWPROJ-001", "test-plan.md");
    const planContent = readFileSync(planPath, "utf8");
    const testPlanContent = readFileSync(testPlanPath, "utf8");

    expect(planContent).toContain("status: draft");
    expect(planContent).toContain("## Scope");
    expect(planContent).toContain("## Acceptance Criteria");
    expect(planContent).toContain("## Vertical Slice");

    expect(testPlanContent).toContain("status: draft");
    expect(testPlanContent).toContain("## Red Tests");
    expect(testPlanContent).toContain("## Green Criteria");
    expect(testPlanContent).toContain("All red tests pass");
    expect(testPlanContent).toContain("bun test");
    expect(testPlanContent).toContain("npx tsc --noEmit");

    const statusResult = runWiki(["forge", "status", "newproj", "NEWPROJ-001", "--json"], env);
    expect(statusResult.exitCode).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.toString());
    expect(statusJson.planStatus).toBe("incomplete");
    expect(statusJson.testPlanStatus).toBe("incomplete");
    expect(statusJson.workflow.validation.nextPhase).toBe("research");
    expect(statusJson.triage.kind).toBe("needs-research");
  });

  test("forge plan accepts --feature to skip feature creation", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "newproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "newproj");
    expect(runWiki(["create-feature", "newproj", "Billing"], env).exitCode).toBe(0);

    const plan = runWiki(["forge", "plan", "newproj", "--feature", "FEAT-001", "--prd-name", "Billing invoices", "--title", "add invoice api", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);
    const out = plan.stdout.toString();
    expect(out).not.toContain("created feature");
    expect(out).toContain("created prd PRD-001");
    expect(out).toContain("created slice NEWPROJ-001");

    const backlog = JSON.parse(runWiki(["backlog", "newproj", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("NEWPROJ-001");
  });

  test("forge plan creates multiple slices with --slices flag", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "multiproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "multiproj");

    const plan = runWiki(
      ["forge", "plan", "multiproj", "Multi Feature", "--slices", "slice one,slice two,slice three", "--agent", "codex", "--repo", repo],
      env,
    );
    expect(plan.exitCode).toBe(0);
    const out = plan.stdout.toString();
    expect(out).toContain("created feature FEAT-001");
    expect(out).toContain("created prd PRD-001");
    expect(out).toContain("created slice MULTIPROJ-001");
    expect(out).toContain("created slice MULTIPROJ-002");
    expect(out).toContain("created slice MULTIPROJ-003");
    expect(out).toContain("started MULTIPROJ-001");
    expect(out).toContain("MULTIPROJ-002");
    expect(out).toContain("MULTIPROJ-003");

    // First slice should be in-progress (started)
    const backlog = JSON.parse(runWiki(["backlog", "multiproj", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("MULTIPROJ-001");
    // Remaining slices stay in Todo
    const todoIds = (backlog.sections["Todo"] ?? []).map((t: { id: string }) => t.id); // desloppify:ignore EMPTY_ARRAY_FALLBACK
    expect(todoIds).toContain("MULTIPROJ-002");
    expect(todoIds).toContain("MULTIPROJ-003");

    // Freshly scaffolded slices keep draft status until the placeholders are replaced.
    for (const sliceId of ["MULTIPROJ-001", "MULTIPROJ-002", "MULTIPROJ-003"]) {
      const planPath = join(vault, "projects", "multiproj", "specs", "slices", sliceId, "plan.md");
      const testPlanPath = join(vault, "projects", "multiproj", "specs", "slices", sliceId, "test-plan.md");
      expect(readFileSync(planPath, "utf8")).toContain("status: draft");
      expect(readFileSync(testPlanPath, "utf8")).toContain("status: draft");
    }
  });

  test("forge next returns pre-implementation triage for active or recommended slices when workflow phases are still incomplete", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "nxproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "nxproj");
    expect(runWiki(["create-issue-slice", "nxproj", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "nxproj", "specs", "slices", "NXPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "nxproj", "specs", "slices", "NXPROJ-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: NXPROJ-001 payments slice\ntype: spec\nspec_kind: plan\nproject: nxproj\ntask_id: NXPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# NXPROJ-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: NXPROJ-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: nxproj\ntask_id: NXPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# NXPROJ-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");

    // Before start-slice: slice is recommended (not active yet)
    const nextBefore = runWiki(["forge", "next", "nxproj", "--json"], env);
    expect(nextBefore.exitCode).toBe(0);
    const beforeJson = JSON.parse(nextBefore.stdout.toString());
    expect(beforeJson.project).toBe("nxproj");
    expect(beforeJson.targetSlice).toBe("NXPROJ-001");
    expect(beforeJson.active).toBe(false);
    expect(beforeJson.planStatus).toBe("ready");
    expect(beforeJson.testPlanStatus).toBe("ready");
    expect(beforeJson.triage.kind).toBe("needs-research");
    expect(beforeJson.steering.lane).toBe("domain-work");
    expect(beforeJson.steering.nextCommand).not.toContain("wiki forge run nxproj NXPROJ-001");

    // After start-slice: slice is active
    expect(runWiki(["forge", "start", "nxproj", "NXPROJ-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);
    const nextAfter = runWiki(["forge", "next", "nxproj", "--json"], env);
    expect(nextAfter.exitCode).toBe(0);
    const afterJson = JSON.parse(nextAfter.stdout.toString());
    expect(afterJson.active).toBe(true);
    expect(afterJson.targetSlice).toBe("NXPROJ-001");
    expect(afterJson.triage.kind).toBe("needs-research");
    expect(afterJson.steering.lane).toBe("domain-work");
    expect(afterJson.steering.nextCommand).not.toContain("wiki forge run nxproj NXPROJ-001");
  });

  test("forge next surfaces load-skill hints for pre-implementation phases", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "phasenext"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "phasenext");
    expect(runWiki(["create-issue-slice", "phasenext", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "phasenext", "PHASENEXT-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const next = runWiki(["forge", "next", "phasenext"], env);
    expect(next.exitCode).toBe(0);
    const output = next.stdout.toString();
    expect(output).toContain("/research");
    expect(output).toContain("load-skill: /research");
  });

  test("forge next --prompt-json outputs sliceId, project, and non-empty planSummary", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "pjproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "pjproj");
    expect(runWiki(["create-issue-slice", "pjproj", "auth slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "pjproj", "specs", "slices", "PJPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "pjproj", "specs", "slices", "PJPROJ-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: PJPROJ-001 auth slice\ntype: spec\nspec_kind: plan\nproject: pjproj\ntask_id: PJPROJ-001\nupdated: 2026-04-13\nstatus: ready\n---\n\n# PJPROJ-001 auth slice\n\n## Scope\n\n- Ship the auth change\n\n## Acceptance Criteria\n\n- [ ] Auth works\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: PJPROJ-001 auth slice\ntype: spec\nspec_kind: test-plan\nproject: pjproj\ntask_id: PJPROJ-001\nupdated: 2026-04-13\nstatus: ready\n---\n\n# PJPROJ-001 auth slice\n\n## Red Tests\n\n- [x] Auth behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");

    const result = runWiki(["forge", "next", "pjproj", "--prompt-json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.sliceId).toBe("PJPROJ-001");
    expect(json.project).toBe("pjproj");
    expect(json.planSummary.length).toBeGreaterThan(0);
    expect(json.testPlanSummary.length).toBeGreaterThan(0);
    expect(json.commands).toBeInstanceOf(Array);
    expect(json.commands.length).toBeGreaterThan(0);
  });

  test("forge next --prompt-json produces non-empty summary when headings differ from canonical names", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "pjproj2"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "pjproj2");
    expect(runWiki(["create-issue-slice", "pjproj2", "auth slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "pjproj2", "specs", "slices", "PJPROJ2-001", "plan.md");
    const testPlanPath = join(vault, "projects", "pjproj2", "specs", "slices", "PJPROJ2-001", "test-plan.md");
    // Use non-canonical headings: "Scope and Goals" instead of "Scope", "Tests" instead of "Red Tests"
    writeFileSync(planPath, "---\ntitle: PJPROJ2-001 auth slice\ntype: spec\nspec_kind: plan\nproject: pjproj2\ntask_id: PJPROJ2-001\nupdated: 2026-04-13\nstatus: ready\n---\n\n# PJPROJ2-001 auth slice\n\n## Scope and Goals\n\n- Ship the auth change\n\n## Acceptance Criteria\n\n- [ ] Auth works\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: PJPROJ2-001 auth slice\ntype: spec\nspec_kind: test-plan\nproject: pjproj2\ntask_id: PJPROJ2-001\nupdated: 2026-04-13\nstatus: ready\n---\n\n# PJPROJ2-001 auth slice\n\n## Tests\n\n- [x] Auth behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");

    const result = runWiki(["forge", "next", "pjproj2", "--prompt-json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.planSummary).not.toBe("(empty)");
    expect(json.testPlanSummary).not.toBe("(empty)");
    expect(json.planSummary.length).toBeGreaterThan(0);
  });

  test("forge run auto-starts an unstarted slice", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autostart"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autostart");
    expect(runWiki(["create-issue-slice", "autostart", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "autostart", "specs", "slices", "AUTOSTART-001", "plan.md");
    const testPlanPath = join(vault, "projects", "autostart", "specs", "slices", "AUTOSTART-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: AUTOSTART-001 payments slice\ntype: spec\nspec_kind: plan\nproject: autostart\ntask_id: AUTOSTART-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# AUTOSTART-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: AUTOSTART-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: autostart\ntask_id: AUTOSTART-001\nupdated: 2026-04-13\nstatus: current\nverification_level: test-verified\n---\n\n# AUTOSTART-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "autostart", "specs/slices/AUTOSTART-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    // Do NOT call forge start — forgeRun should auto-start the slice

    const run = runWiki(["forge", "run", "autostart", "AUTOSTART-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const json = JSON.parse(run.stdout.toString());
    expect(json.check.ok).toBe(true);
    expect(json.close.ok).toBe(true);
    expect(json.check.phase).toBe("close");
    expect(json.close.phase).toBe("verify");

    const backlog = JSON.parse(runWiki(["backlog", "autostart", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("AUTOSTART-001");
  });

  test("forge run writes pipeline_progress to index.md", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "progproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "progproj");
    expect(runWiki(["create-issue-slice", "progproj", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "progproj", "specs", "slices", "PROGPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "progproj", "specs", "slices", "PROGPROJ-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: PROGPROJ-001 payments slice\ntype: spec\nspec_kind: plan\nproject: progproj\ntask_id: PROGPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# PROGPROJ-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: PROGPROJ-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: progproj\ntask_id: PROGPROJ-001\nupdated: 2026-04-13\nstatus: current\nverification_level: test-verified\n---\n\n# PROGPROJ-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "progproj", "specs/slices/PROGPROJ-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "progproj", "PROGPROJ-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const run = runWiki(["forge", "run", "progproj", "PROGPROJ-001", "--repo", repo], env);
    expect(run.exitCode).toBe(0);

    const indexPath = join(vault, "projects", "progproj", "specs", "slices", "PROGPROJ-001", "index.md");
    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("last_forge_run:");
    expect(indexContent).toContain("last_forge_ok:");
  });

  test("forge check auto-heals parent reopen drift (R2) and keeps review passing", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-feature", "gated", "Payments"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-001", "Payments"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "payments slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const featurePath = join(vault, "projects", "gated", "specs", "features", "FEAT-001-payments.md");
    const prdPath = join(vault, "projects", "gated", "specs", "prds", "PRD-001-payments.md");
    const planPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md");
    const testPlanPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md");

    writeFileSync(featurePath, readFileSync(featurePath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(prdPath, readFileSync(prdPath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(planPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-13\nstatus: current\nverification_level: test-verified\n---\n\n# GATED-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    expect(runWiki(["forge", "start", "gated", "GATED-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const check = runWiki(["forge", "check", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(check.exitCode).toBe(0);
    const checkJson = JSON.parse(check.stdout.toString());
    expect(checkJson.review.ok).toBe(true);
    expect(checkJson.triage.command).toContain("wiki forge run gated GATED-001");
    // R2 auto-heal: parent drift is healed (not surfaced as a warning)
    expect(checkJson.review.findings.some((finding: { scope: string; severity: string }) => finding.scope === "parent" && finding.severity === "warning" && finding.message?.includes("status=complete"))).toBe(false);
    // Feature and PRD were reopened by R2
    expect(readFileSync(featurePath, "utf8")).toContain("reopened_reason:");
    expect(readFileSync(prdPath, "utf8")).toContain("reopened_reason:");

    const close = runWiki(["forge", "close", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(close.exitCode).toBe(0);
    const closeJson = JSON.parse(close.stdout.toString());
    expect(closeJson.pipeline.ok).toBe(true);

    const backlog = JSON.parse(runWiki(["backlog", "gated", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("GATED-001");
  });

  test("forge status honors bootstrap workflow profiles for scaffold slices", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "bootproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "bootproj");

    const plan = runWiki(["forge", "plan", "bootproj", "Bootstrap", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);

    const indexPath = join(vault, "projects", "bootproj", "specs", "slices", "BOOTPROJ-001", "index.md");
    const planPath = join(vault, "projects", "bootproj", "specs", "slices", "BOOTPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "bootproj", "specs", "slices", "BOOTPROJ-001", "test-plan.md");

    writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace("status: in-progress", "status: in-progress\nworkflow_profile: bootstrap"), "utf8");
    writeFileSync(planPath, "---\ntitle: BOOTPROJ-001 bootstrap slice\ntype: spec\nspec_kind: plan\nproject: bootproj\ntask_id: BOOTPROJ-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-23\nstatus: ready\n---\n\n# BOOTPROJ-001 bootstrap slice\n\n## Scope\n\n- introduce bootstrap workflow profile coverage\n\n## Vertical Slice\n\n1. validate required phases from the profile\n2. skip research and domain-model for bootstrap slices\n3. preserve existing full-profile behavior\n\n## Acceptance Criteria\n\n- [ ] bootstrap slices route to verify instead of research when PRD, slices, and TDD prerequisites are present\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: BOOTPROJ-001 bootstrap slice\ntype: spec\nspec_kind: test-plan\nproject: bootproj\ntask_id: BOOTPROJ-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-23\nstatus: ready\nverification_commands:\n  - command: bun test tests/forge-ledger.test.ts tests/forge-surface.test.ts\n---\n\n# BOOTPROJ-001 bootstrap slice\n\n## Red Tests\n\n- [ ] bootstrap slices do not require research\n- [ ] bootstrap slices do not require domain-model\n- [ ] forge status reports verify as the next phase\n\n## Green Criteria\n\n- [ ] All red tests pass\n- [ ] No regressions in existing test suite\n\n## Refactor Checks\n\n- [ ] keep phase profile rules centralized in workflow validation\n\n## Verification Commands\n\n```bash\nbun test tests/forge-ledger.test.ts tests/forge-surface.test.ts\n```\n", "utf8");

    const statusResult = runWiki(["forge", "status", "bootproj", "BOOTPROJ-001", "--repo", repo, "--json"], env);
    expect(statusResult.exitCode).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.toString());
    expect(statusJson.planStatus).toBe("ready");
    expect(statusJson.testPlanStatus).toBe("ready");
    expect(statusJson.workflow.validation.nextPhase).toBe("verify");
    expect(statusJson.triage.kind).toBe("close-slice");
    expect(statusJson.triage.command).toContain("wiki forge run bootproj BOOTPROJ-001 --repo");
  });
});
