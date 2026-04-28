import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("verification output capture", () => {
  test("verify-slice caps noisy command output while still passing", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "noisy"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "noisy");
    expect(runWiki(["create-issue-slice", "noisy", "noisy verification", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    const testPlanPath = join(vault, "projects", "noisy", "specs", "slices", "NOISY-001", "test-plan.md");
    writeFileSync(testPlanPath, [
      "---",
      "title: NOISY-001 noisy verification",
      "type: spec",
      "spec_kind: test-plan",
      "project: noisy",
      "task_id: NOISY-001",
      "updated: 2026-04-27T00:00:00.000Z",
      "status: ready",
      "---",
      "",
      "# NOISY-001 noisy verification",
      "",
      "## Verification Commands",
      "",
      "```bash",
      "bun --eval 'for (let i = 0; i < 20000; i += 1) console.log(`noisy-line-${i}`)'",
      "```",
      "",
    ].join("\n"), "utf8");

    const result = runWiki(["verify-slice", "noisy", "NOISY-001", "--repo", repo], env);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString().length).toBeLessThan(80_000);
    expect(result.stderr.toString()).toContain("verification output truncated");
    expect(result.stdout.toString()).toContain("verify-slice NOISY-001: PASS");
    const verifiedPlan = readFileSync(testPlanPath, "utf8");
    expect(verifiedPlan).toContain("verification_level: test-verified");
    expect(verifiedPlan).toContain("verified_against:");
  });

  test("expected-output directives match against the full stream even when captured output is truncated", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "needles"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "needles");
    expect(runWiki(["create-issue-slice", "needles", "needle verification", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    const testPlanPath = join(vault, "projects", "needles", "specs", "slices", "NEEDLES-001", "test-plan.md");
    writeFileSync(testPlanPath, [
      "---",
      "title: NEEDLES-001 needle verification",
      "type: spec",
      "spec_kind: test-plan",
      "project: needles",
      "task_id: NEEDLES-001",
      "updated: 2026-04-27T00:00:00.000Z",
      "status: ready",
      "---",
      "",
      "# NEEDLES-001 needle verification",
      "",
      "## Verification Commands",
      "",
      "```bash",
      "# expect-stdout-contains: middle-stream-marker",
      "bun --eval 'for (let i = 0; i < 12000; i += 1) console.log(`before-${i}`); console.log(`middle-stream-marker`); for (let i = 0; i < 12000; i += 1) console.log(`after-${i}`)'",
      "```",
      "",
    ].join("\n"), "utf8");

    const result = runWiki(["verify-slice", "needles", "NEEDLES-001", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = result.json<{ ok: boolean; commands: Array<{ actual: { stdout: string } }> }>();
    expect(payload.ok).toBe(true);
    expect(payload.commands[0]?.actual.stdout).toContain("verification output truncated");
    expect(payload.commands[0]?.actual.stdout).not.toContain("middle-stream-marker");
  });

  test("forge run keeps failed noisy verification output compact in JSON", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "noisyfail"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "noisyfail");
    expect(runWiki(["create-issue-slice", "noisyfail", "noisy failing verification", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "noisyfail", "specs", "slices", "NOISYFAIL-001", "plan.md"), [
      "---",
      "title: NOISYFAIL-001 plan",
      "type: spec",
      "spec_kind: plan",
      "project: noisyfail",
      "task_id: NOISYFAIL-001",
      "updated: 2026-04-27T00:00:00.000Z",
      "status: ready",
      "---",
      "",
      "# Plan",
      "",
      "## Scope",
      "",
      "- Exercise compact failed verification output.",
      "",
    ].join("\n"), "utf8");
    writeFileSync(join(vault, "projects", "noisyfail", "specs", "slices", "NOISYFAIL-001", "test-plan.md"), [
      "---",
      "title: NOISYFAIL-001 test plan",
      "type: spec",
      "spec_kind: test-plan",
      "project: noisyfail",
      "task_id: NOISYFAIL-001",
      "updated: 2026-04-27T00:00:00.000Z",
      "status: ready",
      "verification_level: test-verified",
      "---",
      "",
      "# Test Plan",
      "",
      "## Verification Commands",
      "",
      "```bash",
      "bun --eval 'for (let i = 0; i < 20000; i += 1) console.error(`noisy-error-${i}`); process.exit(1)'",
      "```",
      "",
    ].join("\n"), "utf8");
    expect(runWiki(["forge", "evidence", "noisyfail", "NOISYFAIL-001", "tdd", "--red", "noisy failure", "--green", "noisy compacted"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "evidence", "noisyfail", "NOISYFAIL-001", "verify", "--command", "bun --eval noisy failure fixture"], env).exitCode).toBe(0);

    const result = runWiki(["forge", "run", "noisyfail", "NOISYFAIL-001", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString().length).toBeLessThan(180_000);
    const payload = result.json<{ close: { stoppedAt: string; steps: Array<{ id: string; stderr?: string }> } }>();
    expect(payload.close.stoppedAt).toBe("verify-slice");
    const verifyStep = payload.close.steps.find((step) => step.id === "verify-slice");
    expect(verifyStep?.stderr).toContain("verification output truncated");
    expect(verifyStep?.stderr?.length ?? 0).toBeLessThan(80_000);
  });
});
