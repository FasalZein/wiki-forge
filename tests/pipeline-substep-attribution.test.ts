import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function makeRunnableSlice(vault: string, repo: string, project: string, sliceId: string, verificationBlock: string) {
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", project], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, project);
  expect(runWiki(["create-issue-slice", project, "payments slice"], env).exitCode).toBe(0);

  const indexPath = join(vault, "projects", project, "specs", "slices", sliceId, "index.md");
  const planPath = join(vault, "projects", project, "specs", "slices", sliceId, "plan.md");
  const testPlanPath = join(vault, "projects", project, "specs", "slices", sliceId, "test-plan.md");

  writeFileSync(
    planPath,
    `---\ntitle: ${sliceId} payments slice\ntype: spec\nspec_kind: plan\nproject: ${project}\ntask_id: ${sliceId}\nupdated: 2026-04-19\nstatus: ready\n---\n\n# ${sliceId} payments slice\n\n## Scope\n\n- Ship the payments change\n`,
    "utf8",
  );
  writeFileSync(
    testPlanPath,
    `---\ntitle: ${sliceId} payments slice\ntype: spec\nspec_kind: test-plan\nproject: ${project}\ntask_id: ${sliceId}\nupdated: 2026-04-19\nstatus: ready\nverification_level: test-verified\nverification_commands:\n  - command: bun test tests/payments.test.ts\n---\n\n# ${sliceId} payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n\`\`\`bash\n${verificationBlock}\n\`\`\`\n`,
    "utf8",
  );

  expect(runWiki(["bind", project, `specs/slices/${sliceId}/index.md`, "src/payments.ts"], env).exitCode).toBe(0);
  const existing = readFileSync(indexPath, "utf8");
  const ledgerBlock = `forge_workflow_ledger:
  research:
    completedAt: '2026-04-19T00:00:00.000Z'
    researchRefs:
      - research/projects/${project}/payments-research.md
  domain-model:
    completedAt: '2026-04-19T00:00:01.000Z'
    decisionRefs:
      - projects/${project}/decisions.md#current-decisions
  prd:
    completedAt: '2026-04-19T00:00:02.000Z'
    prdRef: PRD-001
    parentPrd: PRD-001
  slices:
    completedAt: '2026-04-19T00:00:03.000Z'
    sliceRefs:
      - ${sliceId}
  tdd:
    completedAt: '2026-04-19T00:00:04.000Z'
    tddEvidence:
      - projects/${project}/specs/slices/${sliceId}/test-plan.md
`;
  writeFileSync(indexPath, existing.replace(/\n---\n/u, `\n${ledgerBlock}---\n`), "utf8");

  return env;
}

describe("WIKI-FORGE-146 pipeline sub-step attribution", () => {
  test("forge run verify-slice failure reports rerunCommand and upstreamMutated in JSON", () => {
    const { vault, repo } = setupPassingRepo();
    const env = makeRunnableSlice(
      vault,
      repo,
      "attrrun",
      "ATTRRUN-001",
      "printf 'boom\\n'\nexit 1",
    );

    const result = runWiki(["forge", "run", "attrrun", "ATTRRUN-001", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);

    const payload = JSON.parse(result.stdout.toString());
    expect(payload.check.ok).toBe(true);
    expect(payload.close.ok).toBe(false);
    expect(payload.close.stoppedAt).toBe("verify-slice");

    const failedStep = payload.close.steps.find((step: { id: string }) => step.id === "verify-slice");
    expect(failedStep.rerunCommand).toContain("wiki verify-slice attrrun ATTRRUN-001");
    expect(failedStep.upstreamMutated).toBe(true);
  });

  test("forge check checkpoint failure reports rerunCommand and upstreamMutated in JSON", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "attrcheck"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "attrcheck");
    expect(runWiki(["create-issue-slice", "attrcheck", "payments slice", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    const pagesDir = join(vault, "projects", "attrcheck", "architecture");
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      join(pagesDir, "stale-payments.md"),
      "---\ntitle: stale\ntype: notes\nproject: attrcheck\nsource_paths:\n  - src/payments.ts\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n---\n# stale\n",
      "utf8",
    );

    const result = runWiki(["forge", "check", "attrcheck", "ATTRCHECK-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(1);

    const payload = JSON.parse(result.stdout.toString());
    expect(payload.pipeline.ok).toBe(false);
    expect(payload.pipeline.stoppedAt).toBe("checkpoint");

    const failedStep = payload.pipeline.steps.find((step: { id: string }) => step.id === "checkpoint");
    expect(failedStep.rerunCommand).toContain("wiki checkpoint attrcheck");
    expect(failedStep.upstreamMutated).toBe(false);
  });

  test("forge run checkpoint failure surfaces checkpoint recovery instead of a forge-run loop", () => {
    const { vault, repo } = setupPassingRepo();
    const env = makeRunnableSlice(
      vault,
      repo,
      "attrrepair",
      "ATTRREPAIR-001",
      "bun test tests/payments.test.ts",
    );
    const pagesDir = join(vault, "projects", "attrrepair", "architecture");
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      join(pagesDir, "stale-payments.md"),
      "---\ntitle: stale\ntype: notes\nproject: attrrepair\nsource_paths:\n  - src/payments.ts\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n---\n# stale\n",
      "utf8",
    );

    const result = runWiki(["forge", "run", "attrrepair", "ATTRREPAIR-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(1);

    const payload = JSON.parse(result.stdout.toString());
    expect(payload.check.ok).toBe(false);
    expect(payload.check.stoppedAt).toBe("checkpoint");
    expect(payload.triage.command).toContain("wiki checkpoint attrrepair");
    expect(payload.steering.nextCommand).toContain("wiki checkpoint attrrepair");
    expect(payload.steering.nextCommand).not.toContain("wiki forge run attrrepair ATTRREPAIR-001");

    const text = runWiki(["forge", "run", "attrrepair", "ATTRREPAIR-001", "--repo", repo, "--base", "HEAD~1"], env);
    expect(text.exitCode).toBe(1);
    expect(text.stdout.toString()).toContain("next: wiki checkpoint attrrepair");
    expect(text.stdout.toString()).not.toContain("next: wiki forge run attrrepair ATTRREPAIR-001");
  });

  test("non-json failure output prints rerun command and upstream mutation hint", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "attrtext"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "attrtext");
    expect(runWiki(["create-issue-slice", "attrtext", "payments slice", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    const pagesDir = join(vault, "projects", "attrtext", "architecture");
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      join(pagesDir, "stale-payments.md"),
      "---\ntitle: stale\ntype: notes\nproject: attrtext\nsource_paths:\n  - src/payments.ts\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n---\n# stale\n",
      "utf8",
    );

    const result = runWiki(["forge", "check", "attrtext", "ATTRTEXT-001", "--repo", repo, "--base", "HEAD~1"], env);
    expect(result.exitCode).toBe(1);

    const output = result.stdout.toString();
    expect(output).toContain("rerun: wiki checkpoint attrtext");
    expect(output).toContain("upstream mutated: no");
  });
});
