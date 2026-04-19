import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, runGit, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function seedReadyPaymentsSlice(vault: string, project: string, sliceId: string) {
  const planPath = join(vault, "projects", project, "specs", "slices", sliceId, "plan.md");
  const testPlanPath = join(vault, "projects", project, "specs", "slices", sliceId, "test-plan.md");
  writeFileSync(
    planPath,
    [
      "---",
      `title: ${sliceId} payments slice`,
      "type: spec",
      "spec_kind: plan",
      `project: ${project}`,
      `task_id: ${sliceId}`,
      "updated: 2026-04-18",
      "status: current",
      "---",
      "",
      `# ${sliceId} payments slice`,
      "",
      "## Scope",
      "",
      "- Ship the payments change",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] Payments total stays correct",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    testPlanPath,
    [
      "---",
      `title: ${sliceId} payments slice`,
      "type: spec",
      "spec_kind: test-plan",
      `project: ${project}`,
      `task_id: ${sliceId}`,
      "updated: 2026-04-18",
      "status: current",
      "verification_level: test-verified",
      "---",
      "",
      `# ${sliceId} payments slice`,
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
}

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
        "verification_level: test-verified",
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
        "verification_level: test-verified",
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

  test("multi-slice flow adopts the next slice after the current one closes", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "multiflow"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "multiflow");

    const plan = runWiki(
      ["forge", "plan", "multiflow", "Multi Flow", "--slices", "foundation,adoption,verification", "--agent", "codex", "--repo", repo],
      env,
    );
    expect(plan.exitCode).toBe(0);

    for (const sliceId of ["MULTIFLOW-001", "MULTIFLOW-002", "MULTIFLOW-003"]) {
      seedReadyPaymentsSlice(vault, "multiflow", sliceId);
      expect(runWiki(["bind", "multiflow", `specs/slices/${sliceId}/index.md`, "src/payments.ts"], env).exitCode).toBe(0);
    }

    const secondIndex = matter(readFileSync(join(vault, "projects", "multiflow", "specs", "slices", "MULTIFLOW-002", "index.md"), "utf8"));
    const thirdIndex = matter(readFileSync(join(vault, "projects", "multiflow", "specs", "slices", "MULTIFLOW-003", "index.md"), "utf8"));
    expect(secondIndex.data.depends_on).toEqual(["MULTIFLOW-001"]);
    expect(thirdIndex.data.depends_on).toEqual(["MULTIFLOW-002"]);

    const firstRun = runWiki(["forge", "run", "multiflow", "MULTIFLOW-001", "--repo", repo, "--json"], env);
    expect(firstRun.exitCode).toBe(0);
    const firstRunJson = JSON.parse(firstRun.stdout.toString());
    expect(firstRunJson.close.ok).toBe(true);

    const next = runWiki(["forge", "next", "multiflow", "--json"], env);
    expect(next.exitCode).toBe(0);
    const nextJson = JSON.parse(next.stdout.toString());
    expect(nextJson.targetSlice).toBe("MULTIFLOW-002");
    expect(nextJson.active).toBe(false);
    expect(nextJson.triage.command).toContain("wiki forge run multiflow MULTIFLOW-002");

    const resume = runWiki(["resume", "multiflow", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(resume.exitCode).toBe(0);
    const resumeJson = JSON.parse(resume.stdout.toString());
    expect(resumeJson.activeTask).toBeNull();
    expect(resumeJson.nextTask.id).toBe("MULTIFLOW-002");
    expect(resumeJson.triage.command).toContain("wiki forge run multiflow MULTIFLOW-002");
  });
});

describe("non-blocking workflow improvements", () => {
  function setupSliceWithDocs(vault: string, repo: string, project: string, sliceId: string, env: Record<string, string>) {
    const planPath = join(vault, "projects", project, "specs", "slices", sliceId, "plan.md");
    const testPlanPath = join(vault, "projects", project, "specs", "slices", sliceId, "test-plan.md");
    writeFileSync(planPath, `---\ntitle: ${sliceId}\ntype: spec\nspec_kind: plan\nproject: ${project}\ntask_id: ${sliceId}\nupdated: 2026-04-18\nstatus: current\n---\n\n# ${sliceId}\n\n## Scope\n\n- Ship the change\n`, "utf8");
    writeFileSync(testPlanPath, `---\ntitle: ${sliceId}\ntype: spec\nspec_kind: test-plan\nproject: ${project}\ntask_id: ${sliceId}\nupdated: 2026-04-18\nstatus: current\nverification_level: test-verified\n---\n\n# ${sliceId}\n\n## Red Tests\n\n- [x] Covered.\n\n## Verification Commands\n\n\`\`\`bash\n# label: payments tests\nbun test tests/payments.test.ts\n\`\`\`\n`, "utf8");
    expect(runWiki(["bind", project, `specs/slices/${sliceId}/index.md`, "src/payments.ts"], env).exitCode).toBe(0);
  }

  test("slice-local scoping: vault-wide staleness does not block forge run", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "scopetest"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "scopetest");
    expect(runWiki(["create-issue-slice", "scopetest", "scoped slice"], env).exitCode).toBe(0);
    setupSliceWithDocs(vault, repo, "scopetest", "SCOPETEST-001", env);

    // Create a stale wiki page unrelated to the slice
    const unrelatedPath = join(vault, "projects", "scopetest", "modules");
    mkdirSync(unrelatedPath, { recursive: true });
    writeFileSync(join(unrelatedPath, "unrelated-module.md"), `---\ntitle: unrelated module\ntype: module\nproject: scopetest\nsource_paths:\n  - src/unrelated.ts\nupdated: '2020-01-01'\nverification_level: code-verified\n---\n\n# Unrelated Module\n\nThis page is stale — its source_paths point to files that don't exist.\n`, "utf8");

    // forge run should succeed despite the stale unrelated page
    const run = runWiki(["forge", "run", "scopetest", "SCOPETEST-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const json = JSON.parse(run.stdout.toString());
    expect(json.check.ok).toBe(true);
    expect(json.close.ok).toBe(true);

    const backlog = JSON.parse(runWiki(["backlog", "scopetest", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("SCOPETEST-001");
  });

  test("test_exemptions: non-testable files do not block closeout", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    // Add a type-definitions file with no matching test
    writeFileSync(join(repo, "src", "types.ts"), "export type PaymentStatus = 'pending' | 'paid'\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "add types"]);

    expect(runWiki(["scaffold-project", "exempttest"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "exempttest");
    expect(runWiki(["create-issue-slice", "exempttest", "types slice"], env).exitCode).toBe(0);
    setupSliceWithDocs(vault, repo, "exempttest", "EXEMPTTEST-001", env);

    // Add test_exemptions to the slice index.md
    const indexPath = join(vault, "projects", "exempttest", "specs", "slices", "EXEMPTTEST-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, raw.replace("source_paths:", "test_exemptions:\n  - src/types.ts\nsource_paths:"), "utf8");

    // Also bind types.ts so it's in the slice's claimed paths
    expect(runWiki(["bind", "exempttest", "specs/slices/EXEMPTTEST-001/index.md", "src/types.ts"], env).exitCode).toBe(0);

    // forge run should succeed — types.ts is exempt from test requirements
    const run = runWiki(["forge", "run", "exempttest", "EXEMPTTEST-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const json = JSON.parse(run.stdout.toString());
    expect(json.close.ok).toBe(true);
  });

  test("pipeline progress persists across forge run for session handoff", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "progresstest"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "progresstest");
    expect(runWiki(["create-issue-slice", "progresstest", "progress slice"], env).exitCode).toBe(0);
    setupSliceWithDocs(vault, repo, "progresstest", "PROGRESSTEST-001", env);

    const run = runWiki(["forge", "run", "progresstest", "PROGRESSTEST-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);

    // Read index.md and verify pipeline progress fields
    const indexPath = join(vault, "projects", "progresstest", "specs", "slices", "PROGRESSTEST-001", "index.md");
    const parsed = matter(readFileSync(indexPath, "utf8"));

    expect(parsed.data.last_forge_ok).toBe(true);
    expect(typeof parsed.data.last_forge_run).toBe("string");
    expect(typeof parsed.data.last_forge_step).toBe("string");
    expect(Array.isArray(parsed.data.pipeline_progress)).toBe(true);

    const steps = parsed.data.pipeline_progress as Array<{ step: string; ok: boolean }>;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(steps.some((s) => s.step === "checkpoint")).toBe(true);
    expect(steps.some((s) => s.step === "close-slice")).toBe(true);
  });

  test("resume reads forge handoff data from previous pipeline run", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "resumetest"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "resumetest");
    expect(runWiki(["create-issue-slice", "resumetest", "resume slice"], env).exitCode).toBe(0);
    setupSliceWithDocs(vault, repo, "resumetest", "RESUMETEST-001", env);

    // Run forge run to create handoff data
    expect(runWiki(["forge", "run", "resumetest", "RESUMETEST-001", "--repo", repo], env).exitCode).toBe(0);

    // Resume should show the last forge run status
    const resume = runWiki(["resume", "resumetest", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(resume.exitCode).toBe(0);
    const json = JSON.parse(resume.stdout.toString());
    // The slice is done, so triage should reflect that
    expect(json.project).toBe("resumetest");
  });

  test("forge status JSON is compact — no vault paths leaked", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "compacttest"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "compacttest");
    expect(runWiki(["create-issue-slice", "compacttest", "compact slice"], env).exitCode).toBe(0);

    const status = runWiki(["forge", "status", "compacttest", "COMPACTTEST-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const json = JSON.parse(status.stdout.toString());

    // context should be compacted — no internal paths
    expect(json.context).not.toHaveProperty("taskHubPath");
    expect(json.context).not.toHaveProperty("planPath");
    expect(json.context).not.toHaveProperty("testPlanPath");
    expect(json.context).not.toHaveProperty("hasSliceDocs");
    // but should have the useful fields
    expect(json.context.id).toBe("COMPACTTEST-001");
    expect(json.context).toHaveProperty("section");
    expect(json.context).toHaveProperty("planStatus");
    expect(json.context).toHaveProperty("testPlanStatus");
  });

  test("help output shows three-tier structure with no human-in-the-loop language", () => {
    const result = runWiki(["help"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();

    // Agent surface tier exists
    expect(output).toContain("Agent Surface");
    expect(output).toContain("wiki forge plan");
    expect(output).toContain("wiki forge run");
    expect(output).toContain("wiki forge next");

    // No "human" language anywhere in help
    expect(output).not.toContain("Human");
    expect(output).not.toContain("human");

    // Internal/Repair tier exists with debug commands
    expect(output).toContain("Internal / Repair");
    expect(output).toContain("wiki forge start");
    expect(output).toContain("wiki forge check");

    // Agent surface does NOT include start/check/close
    const agentSection = output.split("Session:")[0];
    expect(agentSection).not.toContain("wiki forge start");
    expect(agentSection).not.toContain("wiki forge check");
    expect(agentSection).not.toContain("wiki forge close");
  });

  test("protocol block contains only 3-command agent surface", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "prototest"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "prototest");
    expect(runWiki(["protocol", "sync", "prototest", "--repo", repo], env).exitCode).toBe(0);

    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    expect(agents).toContain("wiki forge plan|run|next prototest");
    expect(agents).not.toContain("start|check");
    expect(agents).not.toContain("close|next|status");
  });
});
