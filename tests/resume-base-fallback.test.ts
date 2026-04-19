import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupSingleCommitRepo(project: string) {
  const vault = tempDir(`${project}-vault`);
  const repo = tempDir(`${project}-repo`);
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", project], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, project);
  expect(runWiki(["create-issue-slice", project, "auth slice"], env).exitCode).toBe(0);
  expect(runWiki(["forge", "start", project, `${project.toUpperCase()}-001`, "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("resume base fallback", () => {
  test("resume falls back to HEAD on a single-commit repo and emits a note", () => {
    const { repo, env } = setupSingleCommitRepo("fallback");

    const result = runWiki(["resume", "fallback", "--repo", repo, "--json"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain("resume: HEAD~1 unresolvable, falling back to HEAD");
    const payload = result.json<{ base: string }>();
    expect(payload.base).toBe("HEAD");
  });

  test("resume with explicit --base HEAD~1 still works on a multi-commit repo", () => {
    const vault = tempDir("resume-multi-vault");
    const repo = tempDir("resume-multi-repo");
    initVault(vault);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "resumebase"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "resumebase");
    expect(runWiki(["create-issue-slice", "resumebase", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "resumebase", "RESUMEBASE-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["resume", "resumebase", "--repo", repo, "--base", "HEAD~1", "--json"], env);

    expect(result.exitCode).toBe(0);
    expect(result.json<{ base: string }>().base).toBe("HEAD~1");
    expect(result.stderr.toString()).not.toContain("falling back to HEAD");
  });
});
