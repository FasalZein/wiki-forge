import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupPassingRepo() {
  const vault = tempDir("wiki-vault");
  const repo = tempDir("wiki-repo-pass");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 1\n", "utf8");
  writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(1))\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 2\n", "utf8");
  writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(2))\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  return { vault, repo };
}

describe("wiki forge thin surface", () => {
  test("help includes the forge grouped command surface", () => {
    const result = runWiki(["help"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("wiki forge start <project> [slice-id] [--agent <name>] [--repo <path>] [--json]");
    expect(output).toContain("wiki forge check <project> [slice-id] [--repo <path>] [--base <rev>] [--worktree] [--dry-run] [--json]");
    expect(output).toContain("wiki forge status <project> [slice-id] [--json]");
    expect(output).toContain("wiki forge run");
    expect(output).toContain("wiki forge plan");
  });

  test("forge run chains check then close in a single pass", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "runproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "runproj");
    expect(runWiki(["create-issue-slice", "runproj", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "runproj", "specs", "slices", "RUNPROJ-001", "plan.md");
    const testPlanPath = join(vault, "projects", "runproj", "specs", "slices", "RUNPROJ-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: RUNPROJ-001 payments slice\ntype: spec\nspec_kind: plan\nproject: runproj\ntask_id: RUNPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# RUNPROJ-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: RUNPROJ-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: runproj\ntask_id: RUNPROJ-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# RUNPROJ-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "runproj", "specs/slices/RUNPROJ-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "runproj", "RUNPROJ-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const run = runWiki(["forge", "run", "runproj", "RUNPROJ-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);
    const json = JSON.parse(run.stdout.toString());
    expect(json.check.ok).toBe(true);
    expect(json.close.ok).toBe(true);
    expect(json.check.phase).toBe("close");
    expect(json.close.phase).toBe("verify");

    const backlog = JSON.parse(runWiki(["backlog", "runproj", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("RUNPROJ-001");
  });

  test("can start, inspect, check, and close a clean slice through wiki forge", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md");
    const testPlanPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md");
    writeFileSync(planPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    const start = runWiki(["forge", "start", "gated", "GATED-001", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(start.exitCode).toBe(0);
    expect(JSON.parse(start.stdout.toString()).status).toBe("in-progress");

    const status = runWiki(["forge", "status", "gated", "GATED-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout.toString());
    expect(statusJson.context.id).toBe("GATED-001");
    expect(statusJson.triage.kind).toBe("close-slice");
    expect(statusJson.triage.command).toContain("wiki forge close gated GATED-001");
    expect(Array.isArray(statusJson.workflow.validation.statuses)).toBe(true);

    const check = runWiki(["forge", "check", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(check.exitCode).toBe(0);
    const checkJson = JSON.parse(check.stdout.toString());
    expect(checkJson.pipeline.ok).toBe(true);
    expect(checkJson.pipeline.phase).toBe("close");
    expect(checkJson.pipeline.steps.map((step: { id: string }) => step.id)).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);

    const close = runWiki(["forge", "close", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(close.exitCode).toBe(0);
    const closeJson = JSON.parse(close.stdout.toString());
    expect(closeJson.pipeline.ok).toBe(true);
    expect(closeJson.pipeline.phase).toBe("verify");
    expect(closeJson.pipeline.steps.map((step: { id: string }) => step.id)).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);

    const backlog = JSON.parse(runWiki(["backlog", "gated", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("GATED-001");
    expect(readFileSync(testPlanPath, "utf8")).toContain("verification_commands:");
  });

  test("forge plan scaffolds feature, prd, slice, and starts the slice", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "newproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "newproj");

    const plan = runWiki(["forge", "plan", "newproj", "Billing", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);
    const out = plan.stdout.toString();
    expect(out).toContain("created feature FEAT-001");
    expect(out).toContain("created prd PRD-001");
    expect(out).toContain("created slice NEWPROJ-001");

    const backlog = JSON.parse(runWiki(["backlog", "newproj", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("NEWPROJ-001");
  });

  test("forge plan accepts --feature to skip feature creation", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "newproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "newproj");
    expect(runWiki(["create-feature", "newproj", "Billing"], env).exitCode).toBe(0);

    const plan = runWiki(["forge", "plan", "newproj", "--feature", "FEAT-001", "--prd-name", "Billing invoices", "--title", "add invoice api", "--agent", "codex", "--repo", repo], env);
    expect(plan.exitCode).toBe(0);
    const out = plan.stdout.toString();
    expect(out).not.toContain("created feature");
    expect(out).toContain("created prd PRD-001");
    expect(out).toContain("created slice NEWPROJ-001");

    const backlog = JSON.parse(runWiki(["backlog", "newproj", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("NEWPROJ-001");
  });

  test("forge check and close keep parent drift as warnings instead of slice blockers", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-feature", "gated", "Payments"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-001", "Payments"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "payments slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const featurePath = join(vault, "projects", "gated", "specs", "features", "FEAT-001-payments.md");
    const prdPath = join(vault, "projects", "gated", "specs", "prds", "PRD-001-payments.md");
    const planPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md");
    const testPlanPath = join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md");

    writeFileSync(featurePath, readFileSync(featurePath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(prdPath, readFileSync(prdPath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(planPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(testPlanPath, "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Red Tests\n\n- [x] Payments behavior is covered through the public API.\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    expect(runWiki(["forge", "start", "gated", "GATED-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const check = runWiki(["forge", "check", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(check.exitCode).toBe(0);
    const checkJson = JSON.parse(check.stdout.toString());
    expect(checkJson.review.ok).toBe(true);
    expect(checkJson.triage.command).toContain("wiki forge close gated GATED-001");
    expect(checkJson.review.findings.some((finding: { scope: string; severity: string }) => finding.scope === "parent" && finding.severity === "warning")).toBe(true);

    const close = runWiki(["forge", "close", "gated", "GATED-001", "--repo", repo, "--json"], env);
    expect(close.exitCode).toBe(0);
    const closeJson = JSON.parse(close.stdout.toString());
    expect(closeJson.pipeline.ok).toBe(true);

    const backlog = JSON.parse(runWiki(["backlog", "gated", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("GATED-001");
  });
});
