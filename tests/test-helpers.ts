import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const repoRoot = process.cwd();
const tempPaths: string[] = [];

export function tempDir(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempPaths.push(path);
  return path;
}

export function cleanupTempPaths() {
  while (tempPaths.length) {
    const path = tempPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
}

export function runWiki(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync([process.execPath, "src/index.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

export function runGit(repo: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args.join(" ")} failed`);
  }
  return result;
}

export function initVault(vault: string) {
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
}

export function setupVaultAndRepo() {
  const vault = tempDir("wiki-vault");
  const repo = tempDir("wiki-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "tests", "other.test.ts"), "import { test, expect } from 'bun:test'\ntest('other', () => expect(1).toBe(1))\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
  writeFileSync(join(repo, "tests", "other.test.ts"), "import { test, expect } from 'bun:test'\ntest('other changed', () => expect(2 - 1).toBe(1))\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  return { vault, repo };
}

export function setRepoFrontmatter(vault: string, repo: string, project = "demo") {
  const summaryPath = join(vault, "projects", project, "_summary.md");
  const current = readFileSync(summaryPath, "utf8");
  writeFileSync(summaryPath, current.replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");
}
