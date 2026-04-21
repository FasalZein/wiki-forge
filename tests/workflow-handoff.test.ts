import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, setupVaultAndRepo, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupPassingRepo() {
  const vault = tempDir("wiki-vault");
  const repo = tempDir("wiki-repo-pass");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 1\n", "utf8");
  writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(1))\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 2\n", "utf8");
  writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(2))\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  return { vault, repo };
}

function setDependsOn(vault: string, project: string, taskId: string, deps: string[]) {
  const indexPath = join(vault, "projects", project, "specs", "slices", taskId, "index.md");
  const current = readFileSync(indexPath, "utf8");
  const injected = current.replace(`task_id: ${taskId}`, `task_id: ${taskId}\ndepends_on:\n${deps.map((dep) => `  - ${dep}`).join("\n")}`);
  writeFileSync(indexPath, injected, "utf8");
}

describe("wiki workflow handoff improvements", () => {
  test("create-issue-slice writes assignee and source overrides, backlog filters by assignee and shows blocked slices", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "workflow"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "workflow handoff"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/prds/PRD-001-workflow-handoff.md", "src/auth.ts", "src/shared.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "owned slice", "--prd", "PRD-001", "--assignee", "Codex", "--source", "packages/db/src/documents", "--json"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "blocked slice", "--prd", "PRD-001", "--assignee", "Codex"], env).exitCode).toBe(0);
    setDependsOn(vault, "demo", "DEMO-002", ["DEMO-001"]);

    for (const file of ["index.md", "plan.md", "test-plan.md"]) {
      const content = readFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", file), "utf8");
      expect(content).toContain("assignee: Codex");
      expect(content).toContain("packages/db/src/documents");
      expect(content).not.toContain("src/auth.ts");
    }

    const backlog = runWiki(["backlog", "demo", "--assignee", "codex", "--json"], env);
    expect(backlog.exitCode).toBe(0);
    const json = JSON.parse(backlog.stdout.toString());
    expect(json.sections["Cross Links"]).toBeUndefined();
    expect(json.sections.Todo.every((item: { assignee: string }) => item.assignee === "Codex")).toBe(true);
    expect(json.sections.Todo.some((item: { blockedBy: string[] }) => JSON.stringify(item.blockedBy) === JSON.stringify(["DEMO-001"]))).toBe(true);
  });

  test("gate relies on slice lifecycle truth and supports structural refactor mode", () => {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo-structural");
    initVault(vault);
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", type: "module", scripts: { check: "echo check", build: "echo build", test: "echo test" } }, null, 2), "utf8");
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
    writeFileSync(join(repo, "tests", "auth.test.ts"), "import { test, expect } from 'bun:test'\ntest('auth', () => expect(1).toBe(1))\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace("status: draft", "status: done\ncompleted_at: 2026-04-14T00:00:00.000Z"), "utf8");

    const failing = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(failing.exitCode).toBe(1);
    const failingJson = JSON.parse(failing.stdout.toString());
    expect(failingJson.blockers[0]).toContain("changed code file(s)");
    expect(failingJson.warnings.some((warning: string) => warning.includes("marked done in slice docs"))).toBe(false);

    const structural = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--structural-refactor", "--json"], env);
    expect(structural.exitCode).toBe(0);
    const structuralJson = JSON.parse(structural.stdout.toString());
    expect(structuralJson.ok).toBe(true);
    expect(structuralJson.structuralRefactor.testCount.base).toBe(structuralJson.structuralRefactor.testCount.head);
  });

  test("close-slice marks slice docs done and records completion timestamp", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice", "--assignee", "Pi"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\nassignee: Pi\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\nassignee: Pi\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(true);
    expect(typeof json.completedAt).toBe("string");

    const index = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "index.md"), "utf8");
    const testPlan = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "utf8");
    expect(index).toContain("status: done");
    expect(index).toContain("completed_at:");
    expect(index).toContain("verification_level: test-verified");
    expect(testPlan).toContain("verification_level: test-verified");
  });

  test("export-prompt supports pi and resume gives a session pickup view", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--assignee", "Pi", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "plan.md"), "---\ntitle: demo plan\ntype: spec\nspec_kind: plan\nproject: demo\nassignee: Pi\ntask_id: DEMO-001\nstatus: current\nupdated: 2026-04-14\nsource_paths:\n  - src/auth.ts\n---\n\n# Plan\n\n## Scope\n\n- Refine auth slice\n", "utf8");
    writeFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md"), "---\ntitle: demo test plan\ntype: spec\nspec_kind: test-plan\nproject: demo\nassignee: Pi\ntask_id: DEMO-001\nstatus: current\nupdated: 2026-04-14\n---\n\n# Test Plan\n\n## Verification Commands\n\n```bash\nbun test tests/other.test.ts\n```\n", "utf8");
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");

    const prompt = runWiki(["export-prompt", "demo", "DEMO-001", "--agent", "pi"], env);
    expect(prompt.exitCode).toBe(0);
    expect(prompt.stdout.toString()).toContain("You are pi continuing a tracked wiki-forge slice.");
    expect(prompt.stdout.toString()).toContain("src/auth.ts");
    expect(prompt.stdout.toString()).toContain("Protocol reminders:");
    expect(prompt.stdout.toString()).toContain("Use `/forge` for non-trivial implementation work.");
    expect(prompt.stdout.toString()).toContain("wiki forge plan demo");

    const resume = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(resume.exitCode).toBe(0);
    const json = JSON.parse(resume.stdout.toString());
    expect(json.activeTask.id).toBe("DEMO-001");
    expect(json.steering.lane).toBe("domain-work");
    expect(json.steering.nextCommand).not.toContain("wiki forge run demo DEMO-001");
    expect(json.steering.loadSkill).toBe("/research");
    expect(json.dirty.modifiedFiles).toContain("src/auth.ts");
    expect(json.recentCommits.length).toBeGreaterThan(0);
  });

  test("resume keeps earlier workflow gates ahead of a failed verify breadcrumb", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--assignee", "Pi"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    const indexRaw = readFileSync(indexPath, "utf8");
    const withBreadcrumb = indexRaw.replace(
      /^---\n/,
      "---\nlast_forge_run: '2026-04-18T10:00:00.000Z'\nlast_forge_step: verify-slice\nlast_forge_ok: false\nnext_action: rerun verify-slice\nfailure_summary: verify-slice exited 1\n",
    );
    writeFileSync(indexPath, withBreadcrumb, "utf8");

    const resume = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(resume.exitCode).toBe(0);
    const json = JSON.parse(resume.stdout.toString());
    expect(json.workflowNextPhase).toBe("research");
    expect(json.steering.phase).toBe("research");
    expect(json.steering.why).toContain("research");
    expect(json.steering.nextCommand).not.toContain("wiki forge run demo DEMO-001");
    expect(json.lastForgeRun.failureSummary).toBe("verify-slice exited 1");
  });

  test("resume demotes a failed checkpoint breadcrumb when current phase still gates earlier work", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--assignee", "Pi"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    const indexRaw = readFileSync(indexPath, "utf8");
    const withBreadcrumb = indexRaw.replace(
      /^---\n/,
      "---\nlast_forge_run: '2026-04-18T10:00:00.000Z'\nlast_forge_step: checkpoint\nlast_forge_ok: false\nnext_action: rerun checkpoint\nfailure_summary: checkpoint found 4 stale page(s)\n",
    );
    writeFileSync(indexPath, withBreadcrumb, "utf8");

    const resume = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(resume.exitCode).toBe(0);
    const json = JSON.parse(resume.stdout.toString());
    expect(json.workflowNextPhase).toBe("research");
    expect(json.steering.phase).toBe("research");
    expect(json.steering.loadSkill).toBe("/research");
    expect(json.steering.nextCommand).not.toContain("wiki forge run demo DEMO-001");
    expect(json.lastForgeRun.failureSummary).toBe("checkpoint found 4 stale page(s)");
  });

  test("resume warns when a pipeline breadcrumb exists but no handover file was written", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    const withBreadcrumb = readFileSync(indexPath, "utf8").replace(
      /^---\n/,
      "---\nlast_forge_run: '2026-04-18T12:00:00.000Z'\nlast_forge_step: verify-slice\nlast_forge_ok: true\n",
    );
    writeFileSync(indexPath, withBreadcrumb, "utf8");

    const json = JSON.parse(runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env).stdout.toString());
    expect(json.noHandoverButBreadcrumb).toBe(true);
    expect(json.lastForgeRun).toBeDefined();

    const text = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1"], env);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("no handover file");
  });

  test("resume treats running pipeline breadcrumbs as incomplete state, not failed-forge recovery", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    const withBreadcrumb = readFileSync(indexPath, "utf8").replace(
      /^---\n/,
      "---\nlast_forge_run: '2026-04-18T12:00:00.000Z'\nlast_forge_step: update-index\nlast_forge_state: running\nnext_action: wiki forge run demo DEMO-001 --repo /repo\n",
    );
    writeFileSync(indexPath, withBreadcrumb, "utf8");

    const json = JSON.parse(runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env).stdout.toString());
    expect(json.lastForgeRun.lastForgeState).toBe("running");
    expect(json.workflowNextPhase).toBe("research");
    expect(json.triage.kind).toBe("needs-research");
    expect(json.triage.command).not.toContain("wiki forge run demo DEMO-001");

    const text = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1"], env);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("last forge run: INCOMPLETE");
  });

  test("resume preserves verify-phase maintenance recovery commands instead of falling back to forge run", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "payments slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    writeFileSync(
      join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "plan.md"),
      "---\ntitle: DEMO-001 payments slice\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# DEMO-001 payments slice\n\n## Scope\n\n- Ship the payments change\n",
      "utf8",
    );
    writeFileSync(
      join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md"),
      "---\ntitle: DEMO-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-19\nstatus: ready\nverification_level: test-verified\nverification_commands:\n  - command: bun test tests/payments.test.ts\n---\n\n# DEMO-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n",
      "utf8",
    );

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    const withBreadcrumb = readFileSync(indexPath, "utf8").replace(
      /^---\n/,
      `---\nlast_forge_run: '2026-04-18T10:00:00.000Z'\nlast_forge_step: closeout\nlast_forge_ok: false\nnext_action: wiki closeout demo --repo ${repo} --base HEAD --slice-local --slice-id DEMO-001\nfailure_summary: close failed at closeout\n`,
    );
    writeFileSync(indexPath, withBreadcrumb, "utf8");

    const resume = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD", "--json"], env);
    expect(resume.exitCode).toBe(0);
    const json = JSON.parse(resume.stdout.toString());
    expect(json.workflowNextPhase).toBeUndefined();
    expect(json.triage.kind).toBe("resume-failed-forge");
    expect(json.lastForgeRun.nextAction).toBe(`wiki closeout demo --repo ${repo} --base HEAD --slice-local --slice-id DEMO-001`);
    expect(json.triage.command).toBe(`wiki closeout demo --repo ${repo} --base HEAD --slice-local --slice-id DEMO-001`);
    expect(json.steering.nextCommand).toBe(`wiki closeout demo --repo ${repo} --base HEAD --slice-local --slice-id DEMO-001`);
    expect(json.steering.lane).toBe("maintenance-refresh");
    expect(json.steering.nextCommand).not.toContain("wiki forge run demo DEMO-001");
  });
});
