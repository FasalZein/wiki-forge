import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupSlice() {
  const vault = tempDir("forge-status-git-vault");
  const repo = tempDir("forge-status-git-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "trust"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "trust");
  expect(runWiki(["create-issue-slice", "trust", "git truth"], env).exitCode).toBe(0);
  return { env, repo };
}

describe("forge status git truth", () => {
  test("reports dirty worktree state in JSON and human output", () => {
    const { env, repo } = setupSlice();
    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 2\n", "utf8");

    const json = runWiki(["forge", "status", "trust", "TRUST-001", "--repo", repo, "--json"], env);
    expect(json.exitCode).toBe(0);
    const payload = JSON.parse(json.stdout.toString());
    expect(payload.gitTruth.clean).toBe(false);
    expect(payload.gitTruth.unstaged).toEqual(["src/payments.ts"]);

    const text = runWiki(["forge", "status", "trust", "TRUST-001", "--repo", repo], env);
    const output = text.stdout.toString();
    expect(text.exitCode).toBe(0);
    expect(output).toContain("git worktree: DIRTY");
    expect(output).toContain("1 unstaged");
  });
});
