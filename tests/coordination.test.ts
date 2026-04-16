import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, setupVaultAndRepo, tempDir } from "./test-helpers";

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

describe("wiki coordination commands", () => {
  test("next recommends the active slice", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["next", "demo", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.recommendation.id).toBe("DEMO-001");
    expect(json.recommendation.reason).toContain("active");
  });

  test("start-slice moves the slice to in-progress, stamps claim metadata, and returns a plan summary", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "plan.md"), "---\ntitle: DEMO-001 auth slice\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nsource_paths:\n  - src/auth.ts\nupdated: 2026-04-13\nstatus: current\n---\n\n# DEMO-001 auth slice\n\n## Scope\n\n- Split auth work into a smaller slice\n\n## Target Structure\n\n- src/auth.ts\n\n## Acceptance Criteria\n\n- start-slice returns a compact summary\n", "utf8");

    const result = runWiki(["start-slice", "demo", "DEMO-001", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.sliceId).toBe("DEMO-001");
    expect(json.status).toBe("in-progress");
    expect(json.agent).toBe("codex");
    expect(json.claimedPaths).toContain("src/auth.ts");
    expect(json.planSummary).toContain("Split auth work into a smaller slice");

    const backlog = JSON.parse(runWiki(["backlog", "demo", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("DEMO-001");

    const hub = readFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md"), "utf8");
    expect(hub).toContain("status: in-progress");
    expect(hub).toContain("started_at:");
    expect(hub).toContain("claimed_by: codex");
  });

  test("start-slice blocks unmet dependencies with exit code 1", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    const secondHubPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-002", "index.md");
    writeFileSync(secondHubPath, readFileSync(secondHubPath, "utf8").replace("task_id: DEMO-002\n", "task_id: DEMO-002\ndepends_on:\n  - DEMO-001\n"), "utf8");

    const result = runWiki(["start-slice", "demo", "DEMO-002", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.dependencies[0].id).toBe("DEMO-001");
    expect(json.dependencies[0].status).toBe("todo");
    expect(result.stderr.toString()).toContain("blocked by unfinished dependencies");
  });

  test("start-slice reports claim conflicts with exit code 2", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["start-slice", "demo", "DEMO-001", "--agent", "claude", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["start-slice", "demo", "DEMO-002", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(2);
    const json = JSON.parse(result.stdout.toString());
    expect(json.conflicts[0].taskId).toBe("DEMO-001");
    expect(result.stderr.toString()).toContain("claim conflict");
  });

  test("note records agent messages in the durable log", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const result = runWiki(["note", "demo", "left off at auth parser", "--agent", "scout", "--slice", "DEMO-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.agent).toBe("scout");
    expect(json.sliceId).toBe("DEMO-001");
    expect(readFileSync(join(vault, "log.md"), "utf8")).toContain("left off at auth parser");
  });

  test("claim reports overlapping in-progress slices", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/prds/PRD-001-auth-workflow.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["claim", "demo", "DEMO-002", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.ok).toBe(false);
    expect(json.conflicts[0].taskId).toBe("DEMO-001");
    expect(json.conflicts[0].overlap).toContain("src/auth.ts");
  });

  test("handover includes dirty git state and recent notes", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["note", "demo", "left off at parser", "--agent", "worker", "--slice", "DEMO-001"], env).exitCode).toBe(0);
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "new.ts"), "export const n = 1\n", "utf8");

    const result = runWiki(["handover", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.focus.activeTask.id).toBe("DEMO-001");
    expect(json.dirty.modifiedFiles).toContain("src/auth.ts");
    expect(json.dirty.untrackedFiles).toContain("src/new.ts");
    expect(json.recentNotes.some((entry: string) => entry.includes("left off at parser"))).toBe(true);
    // Verify handover file was written (WIKI-FORGE-073)
    expect(json.handoverPath).toBeDefined();
    const handoverDir = join(vault, "projects", "demo", "handovers");
    expect(existsSync(handoverDir)).toBe(true);
    const handoverFiles = readdirSync(handoverDir).filter((f: string) => f.endsWith(".md"));
    expect(handoverFiles.length).toBeGreaterThan(0);
    const handoverContent = readFileSync(join(handoverDir, handoverFiles[0]), "utf8");
    expect(handoverContent).toContain("type: handover");
    expect(handoverContent).toContain("project: demo");
    expect(handoverContent).toContain("## Session Summary");
    expect(handoverContent).toContain("## Recent Commits");
    expect(handoverContent).toContain("## Dirty State");
    expect(handoverContent).toContain("## Next Session Priorities");
    expect(handoverContent).toContain("## What Was Accomplished");
    expect(handoverContent).toContain("## Blockers & Open Questions");
  });

  test("handover with --no-write does not create a file", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["handover", "demo", "--repo", repo, "--base", "HEAD~1", "--json", "--no-write"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.handoverPath).toBeUndefined();
    expect(existsSync(join(vault, "projects", "demo", "handovers"))).toBe(false);
  });

  test("handover with --harness sets harness in frontmatter", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["handover", "demo", "--repo", repo, "--base", "HEAD~1", "--json", "--harness", "claude-code"], env);
    expect(result.exitCode).toBe(0);
    const handoverDir = join(vault, "projects", "demo", "handovers");
    const handoverFiles = readdirSync(handoverDir).filter((f: string) => f.endsWith(".md"));
    const content = readFileSync(join(handoverDir, handoverFiles[0]), "utf8");
    expect(content).toContain("harness: claude-code");
  });

  test("resume surfaces latest handover metadata", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    // First create a handover
    expect(runWiki(["handover", "demo", "--repo", repo, "--base", "HEAD~1", "--harness", "test-harness"], env).exitCode).toBe(0);

    // Then resume should detect it
    const result = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.lastHandover).toBeDefined();
    expect(json.lastHandover.harness).toBe("test-harness");
    expect(json.lastHandover.path).toContain("handovers/");
  });

  test("close-slice moves a passing slice to done", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(true);

    const backlog = runWiki(["backlog", "gated", "--json"], env);
    const backlogJson = JSON.parse(backlog.stdout.toString());
    expect(backlogJson.sections.Done[0].id).toBe("GATED-001");
  });

  test("close-slice blocks when verified code changes again in the worktree", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 3\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(3))\n", "utf8");

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(false);
    expect(json.blockers.some((blocker: string) => blocker.includes("impacted page"))).toBe(true);
  });

  test("close-slice requires a test-verified test plan", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("test-plan must be test-verified");
  });
});
