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

describe("wiki automation commands", () => {
  test("commit-check fails on staged code until the wiki page is refreshed", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "schema.sql"), "select 1;\n", "utf8");
    runGit(repo, ["add", "src/auth.ts", "src/schema.sql"]);

    const failing = runWiki(["commit-check", "demo", "--repo", repo, "--json"], env);
    expect(failing.exitCode).toBe(1);
    const failingJson = JSON.parse(failing.stdout.toString());
    expect(failingJson.stalePages[0].page).toBe("modules/auth/spec.md");
    expect(failingJson.uncoveredFiles).toContain("src/schema.sql");

    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);
    const passing = runWiki(["commit-check", "demo", "--repo", repo, "--json"], env);
    expect(passing.exitCode).toBe(0);
    expect(JSON.parse(passing.stdout.toString()).stalePages).toEqual([]);
  });

  test("checkpoint reports stale pages and unbound files without mutating the wiki", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "fusion.ts"), "export const fusion = true\n", "utf8");

    const failing = runWiki(["checkpoint", "demo", "--repo", repo, "--json"], env);
    expect(failing.exitCode).toBe(1);
    const failingJson = JSON.parse(failing.stdout.toString());
    expect(failingJson.clean).toBe(false);
    expect(failingJson.stalePages[0].page).toBe("modules/auth/spec.md");
    expect(failingJson.unboundFiles).toContain("src/fusion.ts");

    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);
    const passing = runWiki(["checkpoint", "demo", "--repo", repo, "--json"], env);
    expect(passing.exitCode).toBe(0);
    const passingJson = JSON.parse(passing.stdout.toString());
    expect(passingJson.clean).toBe(true);
    expect(passingJson.unboundFiles).toContain("src/fusion.ts");
  });

  test("lint-repo flags disallowed repo markdown files", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, "skills", "custom"), { recursive: true });
    writeFileSync(join(repo, "docs", "ad-hoc.md"), "# nope\n", "utf8");
    writeFileSync(join(repo, ".codex-prompt-test.md"), "# nope\n", "utf8");
    writeFileSync(join(repo, "skills", "custom", "SKILL.md"), "# ok\n", "utf8");

    const result = runWiki(["lint-repo", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.violations).toContain("docs/ad-hoc.md");
    expect(json.violations).toContain(".codex-prompt-test.md");
    expect(json.violations).not.toContain("skills/custom/SKILL.md");
  });

  test("install-git-hook writes a pre-commit hook that calls commit-check", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["install-git-hook", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    const hookBody = readFileSync(json.hookPath, "utf8");
    expect(hookBody).toContain('wiki commit-check "$PROJECT" --repo "$REPO"');
  });

  test("closeout composes refresh drift lint semantic and gate", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    const result = runWiki(["closeout", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.refreshFromGit.impactedPages[0].page).toBe("modules/payments/spec.md");
    expect(Array.isArray(json.nextSteps)).toBe(true);
  });

  test("maintain closeout and gate can inspect dirty worktree edits", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 3\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(3))\n", "utf8");

    const maintain = runWiki(["maintain", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(maintainJson.refreshFromGit.changedFiles).toContain("src/payments.ts");
    expect(maintainJson.refreshFromGit.changedFiles).toContain("tests/payments.test.ts");
    expect(maintainJson.refreshFromGit.impactedPages[0].page).toBe("modules/payments/spec.md");

    const closeout = runWiki(["closeout", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(closeout.exitCode).toBe(1);
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    expect(closeoutJson.ok).toBe(false);
    expect(closeoutJson.staleImpactedPages[0].wikiPage).toBe("modules/payments/spec.md");

    const gate = runWiki(["gate", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(gate.exitCode).toBe(1);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(gateJson.ok).toBe(false);
    expect(gateJson.blockers.some((blocker: string) => blocker.includes("impacted page"))).toBe(true);
  });

  test("maintain can repair legacy done slices idempotently", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "legacy payments slice"], env).exitCode).toBe(0);
    expect(runWiki(["complete-task", "gated", "GATED-001"], env).exitCode).toBe(0);

    for (const file of ["index.md", "plan.md", "test-plan.md"]) {
      const path = join(vault, "projects", "gated", "specs", "slices", "GATED-001", file);
      const current = readFileSync(path, "utf8").replace(/^updated:.*$/m, "updated: '2026-01-01T00:00:00.000Z'");
      writeFileSync(path, current, "utf8");
    }

    const gateBefore = runWiki(["gate", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gateBefore.exitCode).toBe(0);
    const gateBeforeJson = JSON.parse(gateBefore.stdout.toString());
    expect(gateBeforeJson.warnings.some((warning: string) => warning.includes("legacy done-slice metadata drift"))).toBe(true);

    const repair = runWiki(["maintain", "gated", "--repo", repo, "--base", "HEAD~1", "--repair-done-slices", "--json"], env);
    expect(repair.exitCode).toBe(0);
    const repairJson = JSON.parse(repair.stdout.toString());
    expect(repairJson.repair.repaired[0].taskId).toBe("GATED-001");
    expect(repairJson.repair.archiveCandidates.some((candidate: { taskId: string }) => candidate.taskId === "GATED-001")).toBe(true);

    const index = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "index.md"), "utf8");
    const plan = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "utf8");
    const testPlan = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "utf8");
    expect(index).toContain("status: done");
    expect(index).toContain("completed_at:");
    expect(plan).toContain("status: done");
    expect(testPlan).toContain("verification_level: test-verified");

    const repairAgain = runWiki(["maintain", "gated", "--repo", repo, "--base", "HEAD~1", "--repair-done-slices", "--json"], env);
    expect(repairAgain.exitCode).toBe(0);
    const repairAgainJson = JSON.parse(repairAgain.stdout.toString());
    expect(repairAgainJson.repair.repaired).toEqual([]);
    expect(repairAgainJson.repair.alreadyCurrent).toBeGreaterThan(0);

    const gateAfter = runWiki(["gate", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gateAfter.exitCode).toBe(0);
    const gateAfterJson = JSON.parse(gateAfter.stdout.toString());
    expect(gateAfterJson.warnings.some((warning: string) => warning.includes("legacy done-slice metadata drift"))).toBe(false);
  });

  test("refresh-on-merge is CI-friendly and supports verbose output", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    const jsonResult = runWiki(["refresh-on-merge", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(jsonResult.exitCode).toBe(0);
    const json = JSON.parse(jsonResult.stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.impactedPages[0].page).toBe("modules/payments/spec.md");

    const verbose = runWiki(["refresh-on-merge", "gated", "--repo", repo, "--base", "HEAD~1", "--verbose"], env);
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdout.toString()).toContain("impacted: modules/payments/spec.md");
  });
});
