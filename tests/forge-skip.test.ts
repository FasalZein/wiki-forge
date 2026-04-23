import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupSkipFixture() {
  const vault = tempDir("forge-skip-vault");
  const repo = tempDir("forge-skip-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "skipfx"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "skipfx");
  expect(runWiki(["create-issue-slice", "skipfx", "skip-ledger fixture"], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("forge skip CLI (happy path)", () => {
  test("skipping research writes the ledger and advances nextPhase", () => {
    const { vault, env } = setupSkipFixture();

    const before = runWiki(["forge", "status", "skipfx", "SKIPFX-001", "--json"], env);
    expect(before.exitCode).toBe(0);
    const beforeJson = JSON.parse(before.stdout.toString());
    expect(beforeJson.workflow.validation.nextPhase).toBe("research");

    const skip = runWiki(
      [
        "forge", "skip", "skipfx", "SKIPFX-001", "research",
        "--reason", "already satisfied by prior refactor",
        "--agent", "test-agent",
      ],
      env,
    );
    expect(skip.exitCode).toBe(0);

    const indexPath = join(vault, "projects", "skipfx", "specs", "slices", "SKIPFX-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    expect(raw).toContain("forge_workflow_ledger:");
    expect(raw).toContain("skippedPhases:");
    expect(raw).toContain("phase: research");
    expect(raw).toContain("reason: already satisfied by prior refactor");
    expect(raw).toContain("skippedBy: test-agent");

    const after = runWiki(["forge", "status", "skipfx", "SKIPFX-001", "--json"], env);
    expect(after.exitCode).toBe(0);
    const afterJson = JSON.parse(after.stdout.toString());
    expect(afterJson.workflow.validation.nextPhase).toBe("domain-model");
    const research = afterJson.workflow.validation.statuses.find((s: { phase: string }) => s.phase === "research");
    expect(research.completed).toBe(true);
    expect(afterJson.workflow.ledger.skippedPhases).toEqual([
      {
        phase: "research",
        reason: "already satisfied by prior refactor",
        skippedAt: expect.any(String),
        skippedBy: "test-agent",
      },
    ]);
  });

  test("rejects skipping tdd at the CLI — floor is not reason-waivable", () => {
    const { env } = setupSkipFixture();

    const skip = runWiki(
      ["forge", "skip", "skipfx", "SKIPFX-001", "tdd", "--reason", "trust me"],
      env,
    );
    expect(skip.exitCode).not.toBe(0);
    const stderr = skip.stderr.toString();
    expect(stderr).toContain("not skippable");
    expect(stderr).toContain("tdd");
  });

  test("requires --reason with non-empty value", () => {
    const { env } = setupSkipFixture();

    const skip = runWiki(["forge", "skip", "skipfx", "SKIPFX-001", "research"], env);
    expect(skip.exitCode).not.toBe(0);
    expect(skip.stderr.toString()).toContain("--reason is required");
  });

  test("forge run --skip-phase --dry-run prints plan without writing ledger", () => {
    const { vault, env, repo } = setupSkipFixture();

    const run = runWiki(
      [
        "forge", "run", "skipfx", "SKIPFX-001",
        "--repo", repo,
        "--skip-phase", "research",
        "--skip-reason", "dry-run test",
        "--dry-run",
      ],
      env,
    );
    const output = run.stdout.toString() + run.stderr.toString();
    expect(output).toContain("dry-run: would skip research on SKIPFX-001");

    const indexPath = join(vault, "projects", "skipfx", "specs", "slices", "SKIPFX-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    expect(raw).not.toContain("skippedPhases:");
  });

  test("forge run --skip-phase persists skip before the pipeline runs (write-intent semantics)", () => {
    const { vault, env, repo } = setupSkipFixture();

    // The pipeline will fail (slice is barely scaffolded — no plan/test-plan). We only
    // assert that the skip write landed. Skip is a write-intent operation and must
    // persist even when the subsequent pipeline execution bails out.
    runWiki(
      [
        "forge", "run", "skipfx", "SKIPFX-001",
        "--repo", repo,
        "--skip-phase", "research",
        "--skip-reason", "write-intent test",
      ],
      env,
    );

    const indexPath = join(vault, "projects", "skipfx", "specs", "slices", "SKIPFX-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    expect(raw).toContain("skippedPhases:");
    expect(raw).toContain("reason: write-intent test");
  });

  test("re-skipping the same phase with a new reason overrides last-wins", () => {
    const { vault, env } = setupSkipFixture();

    expect(
      runWiki(
        ["forge", "skip", "skipfx", "SKIPFX-001", "research", "--reason", "first", "--agent", "a1"],
        env,
      ).exitCode,
    ).toBe(0);
    expect(
      runWiki(
        ["forge", "skip", "skipfx", "SKIPFX-001", "research", "--reason", "second", "--agent", "a2"],
        env,
      ).exitCode,
    ).toBe(0);

    const indexPath = join(vault, "projects", "skipfx", "specs", "slices", "SKIPFX-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    expect(raw).toContain("reason: second");
    expect(raw).not.toContain("reason: first");

    const status = runWiki(["forge", "status", "skipfx", "SKIPFX-001", "--json"], env);
    const json = JSON.parse(status.stdout.toString());
    expect(json.workflow.ledger.skippedPhases).toHaveLength(1);
    expect(json.workflow.ledger.skippedPhases[0]).toMatchObject({ phase: "research", reason: "second", skippedBy: "a2" });
  });
});
