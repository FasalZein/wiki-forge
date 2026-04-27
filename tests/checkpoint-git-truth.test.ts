import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupProject() {
  const vault = tempDir("checkpoint-git-vault");
  const repo = tempDir("checkpoint-git-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "dirty"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "dirty");
  return { env, repo };
}

describe("checkpoint git truth", () => {
  test("does not report CLEAN when the Git worktree is dirty", () => {
    const { env, repo } = setupProject();
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
    writeFileSync(join(repo, "src", "new-file.ts"), "export const fresh = 1\n", "utf8");

    const result = runWiki(["checkpoint", "dirty", "--repo", repo], env);
    const output = result.stdout.toString() + result.stderr.toString();

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain("Git worktree: DIRTY");
    expect(output).toContain("Result: DIRTY");
    expect(output).not.toContain("Result: CLEAN");
  });

  test("includes Git truth in JSON output", () => {
    const { env, repo } = setupProject();
    writeFileSync(join(repo, "src", "untracked.ts"), "export const untracked = 1\n", "utf8");

    const result = runWiki(["checkpoint", "dirty", "--repo", repo, "--json"], env);
    const payload = JSON.parse(result.stdout.toString());

    expect(result.exitCode).not.toBe(0);
    expect(payload.clean).toBe(false);
    expect(payload.freshnessClean).toBe(true);
    expect(payload.gitTruth.clean).toBe(false);
    expect(payload.gitTruth.untracked).toEqual(["src/untracked.ts"]);
  });
});
