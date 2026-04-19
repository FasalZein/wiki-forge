import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupFixture() {
  const vault = tempDir("wf141rec-vault");
  const repo = tempDir("wf141rec-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wfr"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wfr");
  expect(runWiki(["create-issue-slice", "wfr", "first slice"], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("WIKI-FORGE-141 recovery hint surface (F5)", () => {
  test("forge run workflow-gate JSON payload includes recovery commands", () => {
    const { repo, env } = setupFixture();
    const run = runWiki(["forge", "run", "wfr", "WFR-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).not.toBe(0);
    const payload = JSON.parse(run.stdout.toString());
    expect(payload.step).toBe("operator-lane");
    expect(payload.steering.lane).toBe("domain-work");
    expect(Array.isArray(payload.recovery)).toBe(true);
    expect(payload.recovery.some((c: string) => c.startsWith("wiki forge release"))).toBe(true);
    expect(payload.recovery.some((c: string) => c.startsWith("wiki close-slice"))).toBe(true);
  });

  test("forge run workflow-gate non-JSON output names recovery commands inline", () => {
    const { repo, env } = setupFixture();
    const run = runWiki(["forge", "run", "wfr", "WFR-001", "--repo", repo], env);
    expect(run.exitCode).not.toBe(0);
    const stdout = run.stdout.toString();
    expect(stdout).toContain("wiki forge release");
    expect(stdout).toContain("wiki close-slice");
  });

  test("resume output surfaces recovery hints when triage is resume-failed-forge or a needs-* gate", () => {
    const { vault, repo, env } = setupFixture();
    // Auto-start the slice so it's active. Workflow-next-phase is research, so resume
    // surfaces the needs-research triage — recovery hints must appear for claim-stuck scenarios.
    expect(runWiki(["forge", "start", "wfr", "WFR-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);
    const resume = runWiki(["resume", "wfr", "--repo", repo], env);
    expect(resume.exitCode).toBe(0);
    const stdout = resume.stdout.toString();
    expect(stdout).toContain("wiki forge release");
    expect(stdout).toContain("wiki close-slice");
  });
});
