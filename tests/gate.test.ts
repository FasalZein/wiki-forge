import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo, tempDir, runGit } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("gate diagnostics", () => {
  test("keeps project debt visible as project-scoped warnings", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "ad-hoc.md"), "# nope\n", "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "project" && finding.severity === "warning" && finding.message.includes("repo markdown doc"))).toBe(true);
  });

  test("surfaces parent-scoped warnings for hierarchy drift", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-feature", "demo", "Alpha"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "Alpha"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "alpha slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const featurePath = join(vault, "projects", "demo", "specs", "features", "FEAT-001-alpha.md");
    const prdPath = join(vault, "projects", "demo", "specs", "prds", "PRD-001-alpha.md");
    const slicePath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");

    writeFileSync(featurePath, readFileSync(featurePath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(prdPath, readFileSync(prdPath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(slicePath, readFileSync(slicePath, "utf8").replace("status: draft", "status: done\nverification_level: code-verified"), "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "parent" && finding.severity === "warning" && finding.message.includes("computed="))).toBe(true);
  });
});

describe("gate typecheck", () => {
  function setupRepoWithTypecheck(passingCheck: boolean) {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo");
    mkdirSync(join(repo, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(vault, "projects"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "tests", "auth.test.ts"), "import { test, expect } from 'bun:test'\ntest('auth', () => expect(1).toBe(1))\n", "utf8");
    const checkScript = passingCheck ? "exit 0" : "exit 1";
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { check: checkScript } }, null, 2), "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
    writeFileSync(join(repo, "tests", "auth.test.ts"), "import { test, expect } from 'bun:test'\ntest('auth changed', () => expect(2 - 1).toBe(1))\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    return { vault, repo };
  }

  test("adds blocker when typecheck fails", () => {
    const { vault, repo } = setupRepoWithTypecheck(false);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "slice" && finding.severity === "blocker" && finding.message === "typecheck failed")).toBe(true);
    expect(json.ok).toBe(false);
  });

  test("passes when typecheck succeeds", () => {
    const { vault, repo } = setupRepoWithTypecheck(true);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.every((finding: { scope: string; severity: string; message: string }) => !(finding.severity === "blocker" && finding.message === "typecheck failed"))).toBe(true);
  });
});
