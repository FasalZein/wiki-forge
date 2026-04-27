import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupEvidenceFixture() {
  const vault = tempDir("forge-evidence-vault");
  const repo = tempDir("forge-evidence-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "evfx"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "evfx");
  expect(runWiki(["create-issue-slice", "evfx", "evidence fixture"], env).exitCode).toBe(0);
  return { vault, env };
}

describe("forge evidence CLI", () => {
  test("records TDD evidence on the slice workflow ledger", () => {
    const { vault, env } = setupEvidenceFixture();

    const result = runWiki(
      [
        "forge", "evidence", "evfx", "EVFX-001", "tdd",
        "--red", "client-log-events.test.ts failed before implementation",
        "--green", "bun test __tests__/unit/services/observability/client-log-events.test.ts",
        "--agent", "test-agent",
      ],
      env,
    );

    expect(result.exitCode).toBe(0);
    const indexPath = join(vault, "projects", "evfx", "specs", "slices", "EVFX-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    expect(raw).toContain("forge_workflow_ledger:");
    expect(raw).toContain("tdd:");
    expect(raw).toContain("completedAt:");
    expect(raw).toContain("tddEvidence:");
    expect(raw).toContain("red: client-log-events.test.ts failed before implementation");
    expect(raw).toContain("green: bun test");
    expect(raw).toContain("__tests__/unit/services/observability/client-log-events.test.ts");

    const status = runWiki(["forge", "status", "evfx", "EVFX-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const json = JSON.parse(status.stdout.toString());
    expect(json.workflow.ledger.tdd.tddEvidence).toContain("red: client-log-events.test.ts failed before implementation");
  });

  test("records verify evidence as verification commands", () => {
    const { env } = setupEvidenceFixture();

    const result = runWiki(
      [
        "forge", "evidence", "evfx", "EVFX-001", "verify",
        "--command", "bun typecheck:workspace",
        "--command", "bun test",
        "--json",
      ],
      env,
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.recorded.phase).toBe("verify");
    expect(payload.recorded.evidence).toEqual(["bun typecheck:workspace", "bun test"]);

    const status = runWiki(["forge", "status", "evfx", "EVFX-001", "--json"], env);
    const json = JSON.parse(status.stdout.toString());
    expect(json.workflow.ledger.verify.verificationCommands).toEqual(["bun typecheck:workspace", "bun test"]);
  });

  test("requires actionable evidence values", () => {
    const { env } = setupEvidenceFixture();

    const tdd = runWiki(["forge", "evidence", "evfx", "EVFX-001", "tdd"], env);
    expect(tdd.exitCode).not.toBe(0);
    expect(tdd.stderr.toString()).toContain("tdd evidence requires");

    const verify = runWiki(["forge", "evidence", "evfx", "EVFX-001", "verify", "--note", "tests passed"], env);
    expect(verify.exitCode).not.toBe(0);
    expect(verify.stderr.toString()).toContain("verify evidence requires");
  });
});
