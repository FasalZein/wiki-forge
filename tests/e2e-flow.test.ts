import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("e2e full lifecycle", () => {
  test("forge plan through forge run through forge next completes the 0-to-Z lifecycle", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    // 1. scaffold project
    expect(runWiki(["scaffold-project", "e2eproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "e2eproj");

    // 2. forge plan → creates feature, PRD, slice, auto-starts it
    const plan = runWiki(["forge", "plan", "e2eproj", "E2E Billing", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);
    const planOut = plan.stdout.toString();
    expect(planOut).toContain("created feature FEAT-001");
    expect(planOut).toContain("created prd PRD-001");
    expect(planOut).toContain("created slice E2EPROJ-001");

    // slice is auto-started by forge plan
    const backlogAfterPlan = JSON.parse(runWiki(["backlog", "e2eproj", "--json"], env).stdout.toString());
    expect(backlogAfterPlan.sections["In Progress"][0].id).toBe("E2EPROJ-001");

    // 3. Fill plan.md and test-plan.md with ready content + verification commands
    //    (overwrite auto-fill since we need specific payments test command)
    const planPath = join(vault, "projects", "e2eproj", "specs", "slices", "E2EPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "e2eproj", "specs", "slices", "E2EPROJ-001", "test-plan.md");
    writeFileSync(
      planPath,
      [
        "---",
        "title: E2EPROJ-001 E2E Billing",
        "type: spec",
        "spec_kind: plan",
        "project: e2eproj",
        "task_id: E2EPROJ-001",
        "updated: 2026-04-18",
        "status: current",
        "---",
        "",
        "# E2EPROJ-001 E2E Billing",
        "",
        "## Scope",
        "",
        "- Ship the billing change end-to-end",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] Payments total is computed correctly",
        "",
        "## Vertical Slice",
        "",
        "- src/payments.ts",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      testPlanPath,
      [
        "---",
        "title: E2EPROJ-001 E2E Billing",
        "type: spec",
        "spec_kind: test-plan",
        "project: e2eproj",
        "task_id: E2EPROJ-001",
        "updated: 2026-04-18",
        "status: current",
        "---",
        "",
        "# E2EPROJ-001 E2E Billing",
        "",
        "## Red Tests",
        "",
        "- [x] Payments behavior is covered through the public API.",
        "",
        "## Verification Commands",
        "",
        "```bash",
        "# label: payments tests",
        "bun test tests/payments.test.ts",
        "```",
        "",
      ].join("\n"),
      "utf8",
    );

    // 4. Bind at least one source_path to the slice
    expect(runWiki(["bind", "e2eproj", "specs/slices/E2EPROJ-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    // 5. forge run → auto-check pipeline, verify pipeline, close
    //    (slice is already started by forge plan, so run goes straight through)
    const run = runWiki(["forge", "run", "e2eproj", "E2EPROJ-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const runJson = JSON.parse(run.stdout.toString());
    expect(runJson.check.ok).toBe(true);
    expect(runJson.close.ok).toBe(true);
    expect(runJson.check.phase).toBe("close");
    expect(runJson.close.phase).toBe("verify");

    // 6. Verify slice is in Done section
    const backlogDone = JSON.parse(runWiki(["backlog", "e2eproj", "--json"], env).stdout.toString());
    expect(backlogDone.sections.Done[0].id).toBe("E2EPROJ-001");

    // 7. Verify index.md has pipeline_progress in frontmatter
    const indexPath = join(vault, "projects", "e2eproj", "specs", "slices", "E2EPROJ-001", "index.md");
    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("pipeline_progress:");

    // 8. forge next → recommends next task or reports no ready slices when all done
    const next = runWiki(["forge", "next", "e2eproj", "--json"], env);
    expect(next.exitCode).toBe(0);
    const nextJson = JSON.parse(next.stdout.toString());
    expect(nextJson.project).toBe("e2eproj");
    // When all slices are done, targetSlice is null and action is "no ready slices"
    // When a slice is still active/recommended, result includes triage
    // Both are valid outcomes — verify the response is well-formed either way
    const isNoSlices = nextJson.targetSlice === null;
    const hasReadySlice = nextJson.triage !== undefined;
    expect(isNoSlices || hasReadySlice).toBe(true);

    // 9. forge status on the closed slice → triage.kind should be "completed"
    const status = runWiki(["forge", "status", "e2eproj", "E2EPROJ-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout.toString());
    expect(statusJson.triage.kind).toBe("completed");
    expect(statusJson.context.id).toBe("E2EPROJ-001");
  });

  test("forge run auto-starts an unstarted slice through the full pipeline", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    // scaffold project
    expect(runWiki(["scaffold-project", "autofull"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autofull");

    // Create slice via create-issue-slice (NOT forge plan, which auto-starts)
    expect(runWiki(["create-issue-slice", "autofull", "payments slice"], env).exitCode).toBe(0);

    // Fill docs
    const planPath = join(vault, "projects", "autofull", "specs", "slices", "AUTOFULL-001", "plan.md");
    const testPlanPath = join(vault, "projects", "autofull", "specs", "slices", "AUTOFULL-001", "test-plan.md");
    writeFileSync(
      planPath,
      [
        "---",
        "title: AUTOFULL-001 payments slice",
        "type: spec",
        "spec_kind: plan",
        "project: autofull",
        "task_id: AUTOFULL-001",
        "updated: 2026-04-18",
        "status: current",
        "---",
        "",
        "# AUTOFULL-001 payments slice",
        "",
        "## Scope",
        "",
        "- Ship the payments change",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      testPlanPath,
      [
        "---",
        "title: AUTOFULL-001 payments slice",
        "type: spec",
        "spec_kind: test-plan",
        "project: autofull",
        "task_id: AUTOFULL-001",
        "updated: 2026-04-18",
        "status: current",
        "---",
        "",
        "# AUTOFULL-001 payments slice",
        "",
        "## Red Tests",
        "",
        "- [x] Payments behavior is covered through the public API.",
        "",
        "## Verification Commands",
        "",
        "```bash",
        "# label: payments tests",
        "bun test tests/payments.test.ts",
        "```",
        "",
      ].join("\n"),
      "utf8",
    );

    // Bind source paths
    expect(runWiki(["bind", "autofull", "specs/slices/AUTOFULL-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    // Call forge run directly — skip forge start
    const run = runWiki(["forge", "run", "autofull", "AUTOFULL-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const runJson = JSON.parse(run.stdout.toString());

    // Verify it auto-started and closed successfully
    expect(runJson.check.ok).toBe(true);
    expect(runJson.close.ok).toBe(true);
    expect(runJson.check.phase).toBe("close");
    expect(runJson.close.phase).toBe("verify");

    // Verify slice ended up in Done
    const backlog = JSON.parse(runWiki(["backlog", "autofull", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("AUTOFULL-001");

    // Verify pipeline_progress is in index.md frontmatter
    const indexPath = join(vault, "projects", "autofull", "specs", "slices", "AUTOFULL-001", "index.md");
    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("pipeline_progress:");
  });
});
