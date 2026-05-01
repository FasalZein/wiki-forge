import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

function setupProject() {
  const vault = tempDir("doctor-output-vault");
  const repo = tempDir("doctor-output-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "demo");
  return { env, repo };
}

describe("doctor operator output", () => {
  test("degraded non-JSON doctor output includes recovery commands", () => {
    const { env, repo } = setupProject();
    writeFileSync(join(repo, "src", "uncovered.ts"), "export const uncovered = 1\n", "utf8");

    const result = runWiki(["doctor", "demo", "--repo", repo, "--base", "HEAD"], env);
    const output = result.stdout.toString() + result.stderr.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toContain("doctor for demo:");
    expect(output).toContain("Recovery:");
    expect(output).toContain(`wiki checkpoint demo --repo ${repo} --base HEAD --json`);
    expect(output).toContain(`wiki maintain demo --repo ${repo} --base HEAD`);
    expect(output).toContain(`wiki doctor demo --repo ${repo} --base HEAD`);
    expect(output).toContain(`wiki forge next demo --repo ${repo} --json`);
  });

  test("doctor JSON output remains automation-only without recovery property", () => {
    const { env, repo } = setupProject();
    writeFileSync(join(repo, "src", "uncovered.ts"), "export const uncovered = 1\n", "utf8");

    const result = runWiki(["doctor", "demo", "--repo", repo, "--base", "HEAD", "--json"], env);
    const payload = result.json();

    expect(result.exitCode).toBe(0);
    expect(payload.project).toBe("demo");
    expect(payload).not.toHaveProperty("recovery");
  });
});
