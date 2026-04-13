import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  });

  test("close-slice moves a passing slice to done", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Red Tests\n\n- payments regression covered\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(true);

    const backlog = runWiki(["backlog", "gated", "--json"], env);
    const backlogJson = JSON.parse(backlog.stdout.toString());
    expect(backlogJson.sections.Done[0].id).toBe("GATED-001");
  });
});
