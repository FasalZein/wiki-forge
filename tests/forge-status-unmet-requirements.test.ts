import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupStatusFixture() {
  const vault = tempDir("forge-status-vault");
  const repo = tempDir("forge-status-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wfstatus"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wfstatus");
  expect(runWiki(["create-issue-slice", "wfstatus", "status slice"], env).exitCode).toBe(0);
  return { repo, env, vault };
}

function setHubLedger(vault: string) {
  const indexPath = join(vault, "projects", "wfstatus", "specs", "slices", "WFSTATUS-001", "index.md");
  const existing = readFileSync(indexPath, "utf8");
  const ledgerBlock = `forge_workflow_ledger:
  research:
    completedAt: '2026-04-19T00:00:00.000Z'
    researchRefs:
      - research/projects/wfstatus/status-research.md
  grill:
    completedAt: '2026-04-19T00:00:01.000Z'
    decisionRefs:
      - projects/wfstatus/decisions.md#current-decisions
  prd:
    completedAt: '2026-04-19T00:00:02.000Z'
    prdRef: PRD-001
    parentPrd: PRD-001
  slices:
    completedAt: '2026-04-19T00:00:03.000Z'
    sliceRefs:
      - WFSTATUS-001
  tdd:
    completedAt: '2026-04-19T00:00:04.000Z'
    tddEvidence:
      - projects/wfstatus/specs/slices/WFSTATUS-001/test-plan.md
`;
  writeFileSync(indexPath, existing.replace(/\n---\n/u, `\n${ledgerBlock}---\n`), "utf8");
}

describe("forge status unmet requirements", () => {
  test("json output includes unmet arrays for incomplete phases", () => {
    const { env } = setupStatusFixture();

    const result = runWiki(["forge", "status", "wfstatus", "WFSTATUS-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    const research = payload.workflow.validation.statuses.find((status: { phase: string }) => status.phase === "research");
    expect(research.unmet).toEqual(["research.completedAt", "research.researchRefs"]);
  });

  test("non-json output prints unmet line under workflow next phase", () => {
    const { env } = setupStatusFixture();

    const result = runWiki(["forge", "status", "wfstatus", "WFSTATUS-001"], env);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("- workflow next phase: research");
    expect(output).toContain("  unmet: research.completedAt, research.researchRefs");
  });

  test("verify stays unmet until verification evidence exists", () => {
    const { env, vault } = setupStatusFixture();
    setHubLedger(vault);

    const result = runWiki(["forge", "status", "wfstatus", "WFSTATUS-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.workflow.validation.nextPhase).toBe("verify");
    const verify = payload.workflow.validation.statuses.find((status: { phase: string }) => status.phase === "verify");
    expect(verify.unmet).toEqual(["verify.completedAt", "verify.verificationCommands"]);
  });
});
