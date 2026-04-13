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
