import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

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
  domain-model:
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

function setLegacyHubLedger(vault: string) {
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

  test("json output normalizes legacy grill storage to domain-model", () => {
    const { env, vault } = setupStatusFixture();
    setLegacyHubLedger(vault);

    const result = runWiki(["forge", "status", "wfstatus", "WFSTATUS-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.workflow.ledger["domain-model"]).toBeDefined();
    expect(payload.workflow.ledger.grill).toBeUndefined();
  });

  test("distilled-only research stays unmet until adopted into the parent PRD", () => {
    const { env, vault } = setupStatusFixture();

    expect(runWiki(["create-feature", "wfstatus", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "wfstatus", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "wfstatus", "tracked slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["research", "scaffold", "status-topic"], env).exitCode).toBe(0);

    const pagePath = join(vault, "research", "status-topic", "verified-note.md");
    writeFileSync(pagePath, `---\ntitle: Verified Note\ntype: research\ntopic: status-topic\nproject: wfstatus\nstatus: verified\nsource_type: article\nsources:\n  - url: https://example.com\n    accessed: 2026-04-20\n    claim: Verified claim\ninfluenced_by: []\nupdated: 2026-04-20\nverification_level: source-checked\n---\n# Verified Note\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

    expect(runWiki(["research", "distill", "research/status-topic/verified-note", "projects/wfstatus/decisions", "--json"], env).exitCode).toBe(0);

    const beforeAdopt = runWiki(["forge", "status", "wfstatus", "WFSTATUS-002", "--json"], env);
    expect(beforeAdopt.exitCode).toBe(0);
    const beforeJson = JSON.parse(beforeAdopt.stdout.toString());
    expect(beforeJson.workflow.validation.nextPhase).toBe("research");

    const adopt = runWiki(["research", "adopt", "research/status-topic/verified-note", "--project", "wfstatus", "--slice", "WFSTATUS-002", "--json"], env);
    expect(adopt.exitCode).toBe(0);

    const afterAdopt = runWiki(["forge", "status", "wfstatus", "WFSTATUS-002", "--json"], env);
    expect(afterAdopt.exitCode).toBe(0);
    const afterJson = JSON.parse(afterAdopt.stdout.toString());
    expect(afterJson.workflow.validation.nextPhase).toBe("domain-model");
    expect(afterJson.workflow.ledger.research.researchRefs).toContain("research/status-topic/verified-note");
  });
});
