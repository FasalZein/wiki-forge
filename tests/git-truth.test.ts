import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectGitTruth } from "../src/forge/core/git-truth";
import { cleanupTempPaths, runGit, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupRepo() {
  const repo = tempDir("git-truth-repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "tracked.ts"), "export const value = 1\n", "utf8");
  writeFileSync(join(repo, "src", "rename-me.ts"), "export const renamed = 1\n", "utf8");
  writeFileSync(join(repo, "src", "delete-me.ts"), "export const deleted = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  return repo;
}

describe("collectGitTruth", () => {
  test("reports a clean worktree", async () => {
    const repo = setupRepo();

    const truth = await collectGitTruth(repo);

    expect(truth.clean).toBe(true);
    expect(truth.changedFiles).toEqual([]);
    expect(truth.fingerprint).toBe("");
  });

  test("classifies staged, unstaged, untracked, deleted, and renamed files", async () => {
    const repo = setupRepo();
    writeFileSync(join(repo, "src", "tracked.ts"), "export const value = 2\n", "utf8");
    writeFileSync(join(repo, "src", "staged.ts"), "export const staged = 1\n", "utf8");
    runGit(repo, ["add", "src/staged.ts"]);
    writeFileSync(join(repo, "src", "untracked.ts"), "export const untracked = 1\n", "utf8");
    runGit(repo, ["rm", "-q", "src/delete-me.ts"]);
    renameSync(join(repo, "src", "rename-me.ts"), join(repo, "src", "renamed.ts"));
    runGit(repo, ["add", "-A", "src/rename-me.ts", "src/renamed.ts"]);

    const truth = await collectGitTruth(repo);

    expect(truth.clean).toBe(false);
    expect(truth.staged).toEqual(["src/delete-me.ts", "src/renamed.ts", "src/staged.ts"]);
    expect(truth.unstaged).toEqual(["src/tracked.ts"]);
    expect(truth.untracked).toEqual(["src/untracked.ts"]);
    expect(truth.deleted).toEqual(["src/delete-me.ts"]);
    expect(truth.renamed).toEqual([{ from: "src/rename-me.ts", to: "src/renamed.ts" }]);
    expect(truth.changedFiles).toContain("src/tracked.ts");
    expect(truth.changedFiles).toContain("src/untracked.ts");
    expect(truth.fingerprint).toContain("M:src/tracked.ts");
    expect(truth.fingerprint).toContain("?:src/untracked.ts");
  });
});
