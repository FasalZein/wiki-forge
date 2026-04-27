import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runGit, runWiki, setRepoFrontmatter, setupPassingRepo, setupVaultAndRepo, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki automation commands", () => {
  test("commit-check fails on staged code until the wiki page is refreshed", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "schema.sql"), "select 1;\n", "utf8");
    runGit(repo, ["add", "src/auth.ts", "src/schema.sql"]);

    const failing = runWiki(["commit-check", "demo", "--repo", repo, "--json"], env);
    expect(failing.exitCode).toBe(1);
    const failingJson = JSON.parse(failing.stdout.toString());
    expect(failingJson.stalePages[0].page).toBe("modules/auth/spec.md");
    expect(failingJson.uncoveredFiles).toContain("src/schema.sql");

    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);
    const passing = runWiki(["commit-check", "demo", "--repo", repo, "--json"], env);
    expect(passing.exitCode).toBe(0);
    expect(JSON.parse(passing.stdout.toString()).stalePages).toEqual([]);
  });

  test("checkpoint reports stale pages and unbound files without mutating the wiki", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "fusion.ts"), "export const fusion = true\n", "utf8");

    const failing = runWiki(["checkpoint", "demo", "--repo", repo, "--json"], env);
    expect(failing.exitCode).toBe(1);
    const failingJson = JSON.parse(failing.stdout.toString());
    expect(failingJson.clean).toBe(false);
    expect(failingJson.stalePages[0].page).toBe("modules/auth/spec.md");
    expect(failingJson.unboundFiles).toContain("src/fusion.ts");

    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);
    const passing = runWiki(["checkpoint", "demo", "--repo", repo, "--json"], env);
    expect(passing.exitCode).toBe(1);
    const passingJson = JSON.parse(passing.stdout.toString());
    expect(passingJson.freshnessClean).toBe(true);
    expect(passingJson.clean).toBe(false);
    expect(passingJson.gitTruth.clean).toBe(false);
    expect(passingJson.unboundFiles).toContain("src/fusion.ts");
  });

  test("lint-repo flags disallowed repo markdown files", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, "skills", "custom"), { recursive: true });
    writeFileSync(join(repo, "docs", "ad-hoc.md"), "# nope\n", "utf8");
    writeFileSync(join(repo, ".codex-prompt-test.md"), "# nope\n", "utf8");
    writeFileSync(join(repo, "skills", "custom", "SKILL.md"), "# ok\n", "utf8");

    const result = runWiki(["lint-repo", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.violations).toContain("docs/ad-hoc.md");
    expect(json.violations).toContain(".codex-prompt-test.md");
    expect(json.violations).not.toContain("skills/custom/SKILL.md");
  });

  test("install-git-hook writes a pre-commit hook that calls commit-check", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["install-git-hook", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    const hookBody = readFileSync(json.hookPath, "utf8");
    expect(hookBody).toContain('wiki commit-check "$PROJECT" --repo "$REPO"');
  });

  test("closeout composes refresh drift lint semantic and gate", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    const result = runWiki(["closeout", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.refreshFromGit.impactedPages[0].page).toBe("modules/payments/spec.md");
    expect(Array.isArray(json.nextSteps)).toBe(true);
  });

  test("closeout emits PASS — ready to close when state is clean", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    const jsonResult = runWiki(["closeout", "gated", "--repo", repo, "--base", "HEAD", "--json"], env);
    expect(jsonResult.exitCode).toBe(0);
    const json = JSON.parse(jsonResult.stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.blockers.length).toBe(0);
    expect(json.staleImpactedPages.length).toBe(0);
    expect(json.refreshFromGit.impactedPages.length).toBe(0);
    expect(json.nextSteps.length).toBe(0);

    const rendered = runWiki(["closeout", "gated", "--repo", repo, "--base", "HEAD"], env);
    expect(rendered.exitCode).toBe(0);
    const stdout = rendered.stdout.toString();
    expect(stdout).toContain("PASS — ready to close");
    expect(stdout).not.toContain("REVIEW PASS");
    expect(stdout).not.toContain("manual steps before closing");
  });

  test("maintain closeout and gate can inspect dirty worktree edits", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 3\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(3))\n", "utf8");

    const maintain = runWiki(["maintain", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(maintainJson.refreshFromGit.changedFiles).toContain("src/payments.ts");
    expect(maintainJson.refreshFromGit.changedFiles).toContain("tests/payments.test.ts");
    expect(maintainJson.refreshFromGit.impactedPages[0].page).toBe("modules/payments/spec.md");
    expect(maintainJson.actions.some((action: { kind: string; scope?: string }) => action.kind === "review-page" && action.scope === "slice")).toBe(true);

    const closeout = runWiki(["closeout", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(closeout.exitCode).toBe(1);
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    expect(closeoutJson.ok).toBe(false);
    expect(closeoutJson.staleImpactedPages[0].wikiPage).toBe("modules/payments/spec.md");

    const gate = runWiki(["gate", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(gate.exitCode).toBe(1);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(gateJson.ok).toBe(false);
    expect(gateJson.blockers.some((blocker: string) => blocker.includes("impacted page"))).toBe(true);
  });

  test("maintain can repair legacy done slices idempotently", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "legacy payments slice"], env).exitCode).toBe(0);
    expect(runWiki(["complete-task", "gated", "GATED-001"], env).exitCode).toBe(0);

    for (const file of ["index.md", "plan.md", "test-plan.md"]) {
      const path = join(vault, "projects", "gated", "specs", "slices", "GATED-001", file);
      const current = readFileSync(path, "utf8").replace(/^updated:.*$/m, "updated: '2026-01-01T00:00:00.000Z'");
      writeFileSync(path, current, "utf8");
    }

    const gateBefore = runWiki(["gate", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gateBefore.exitCode).toBe(0);
    const gateBeforeJson = JSON.parse(gateBefore.stdout.toString());
    expect(gateBeforeJson.warnings.some((warning: string) => warning.includes("legacy done-slice metadata drift"))).toBe(true);

    const repair = runWiki(["maintain", "gated", "--repo", repo, "--base", "HEAD~1", "--repair-done-slices", "--json"], env);
    expect(repair.exitCode).toBe(0);
    const repairJson = JSON.parse(repair.stdout.toString());
    expect(repairJson.repair.repaired[0].taskId).toBe("GATED-001");
    expect(repairJson.repair.archiveCandidates.some((candidate: { taskId: string }) => candidate.taskId === "GATED-001")).toBe(true);

    const index = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "index.md"), "utf8");
    const plan = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "utf8");
    const testPlan = readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "utf8");
    expect(index).toContain("status: done");
    expect(index).toContain("completed_at:");
    expect(plan).toContain("status: done");
    expect(testPlan).toContain("verification_level: test-verified");

    const repairAgain = runWiki(["maintain", "gated", "--repo", repo, "--base", "HEAD~1", "--repair-done-slices", "--json"], env);
    expect(repairAgain.exitCode).toBe(0);
    const repairAgainJson = JSON.parse(repairAgain.stdout.toString());
    expect(repairAgainJson.repair.repaired).toEqual([]);
    expect(repairAgainJson.repair.alreadyCurrent).toBeGreaterThan(0);

    const gateAfter = runWiki(["gate", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gateAfter.exitCode).toBe(0);
    const gateAfterJson = JSON.parse(gateAfter.stdout.toString());
    expect(gateAfterJson.warnings.some((warning: string) => warning.includes("legacy done-slice metadata drift"))).toBe(false);
  });

  test("worktree closeout suppresses stale done-slice pages from blockers", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    // Create a module page that also binds to src/payments.ts (actionable coverage).
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);
    // Historical done-slice binding exercises stale-page suppression.
    expect(runWiki(["create-issue-slice", "gated", "old payments work", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["complete-task", "gated", "GATED-001"], env).exitCode).toBe(0);
    expect(runWiki(["maintain", "gated", "--repo", repo, "--base", "HEAD~1", "--repair-done-slices"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 99\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(99))\n", "utf8");

    const closeout = runWiki(["closeout", "gated", "--repo", repo, "--worktree", "--json"], env);
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    const staleWikiPages = closeoutJson.staleImpactedPages.map((p: { wikiPage: string }) => p.wikiPage);
    expect(staleWikiPages.some((p: string) => p.includes("specs/slices/GATED-001"))).toBe(false);
    expect(closeoutJson.suppressedPages.length).toBeGreaterThan(0);
    expect(closeoutJson.suppressedPages.some((p: { page: string }) => p.page.includes("specs/slices/GATED-001"))).toBe(true);
    expect(closeoutJson.warnings.some((w: string) => w.includes("suppressed"))).toBe(true);
  });

  test("worktree closeout suppresses stale todo-slice pages outside the active slice", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "active payments work", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "future payments work", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 99\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(99))\n", "utf8");

    const closeout = runWiki(["closeout", "gated", "--repo", repo, "--worktree", "--json"], env);
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    const staleWikiPages = closeoutJson.staleImpactedPages.map((p: { wikiPage: string }) => p.wikiPage);
    expect(staleWikiPages.some((p: string) => p.includes("specs/slices/GATED-001"))).toBe(true);
    expect(staleWikiPages.some((p: string) => p.includes("specs/slices/GATED-002"))).toBe(false);
    expect(closeoutJson.suppressedPages.some((p: { page: string }) => p.page.includes("specs/slices/GATED-002"))).toBe(true);
    expect(closeoutJson.warnings.some((w: string) => w.includes("non-actionable planning page"))).toBe(true);
  });

  test("worktree closeout suppresses unrelated feature and PRD planning pages outside the active hierarchy", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-feature", "gated", "active feature"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-001", "active prd"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "gated", "future feature"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-002", "future prd"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "active slice", "--prd", "PRD-001", "--source", "src/payments.ts"], env).exitCode).toBe(0);

    const activePrd = join(vault, "projects", "gated", "specs", "prds", "PRD-001-active-prd.md");
    const futurePrd = join(vault, "projects", "gated", "specs", "prds", "PRD-002-future-prd.md");
    const activeFeature = join(vault, "projects", "gated", "specs", "features", "FEAT-001-active-feature.md");
    const futureFeature = join(vault, "projects", "gated", "specs", "features", "FEAT-002-future-feature.md");
    for (const path of [activePrd, futurePrd, activeFeature, futureFeature]) {
      writeFileSync(path, readFileSync(path, "utf8").replace("source_paths: []", "source_paths:\n  - src/payments.ts"), "utf8");
    }

    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 99\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(99))\n", "utf8");

    const closeout = runWiki(["closeout", "gated", "--repo", repo, "--worktree", "--json"], env);
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    const staleWikiPages = closeoutJson.staleImpactedPages.map((p: { wikiPage: string }) => p.wikiPage);
    expect(staleWikiPages).toContain("specs/prds/PRD-001-active-prd.md");
    expect(staleWikiPages).toContain("specs/features/FEAT-001-active-feature.md");
    expect(staleWikiPages).not.toContain("specs/prds/PRD-002-future-prd.md");
    expect(staleWikiPages).not.toContain("specs/features/FEAT-002-future-feature.md");
    expect(closeoutJson.suppressedPages.some((p: { page: string }) => p.page === "specs/prds/PRD-002-future-prd.md")).toBe(true);
    expect(closeoutJson.suppressedPages.some((p: { page: string }) => p.page === "specs/features/FEAT-002-future-feature.md")).toBe(true);
  });

  test("worktree closeout does not block on code covered only by non-actionable planning pages outside the active hierarchy", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    writeFileSync(join(repo, "src", "current.ts"), "export const current = 1\n", "utf8");
    writeFileSync(join(repo, "tests", "current.test.ts"), "import { expect, test } from 'bun:test'\nimport { current } from '../src/current'\ntest('current', () => expect(current).toBe(1))\n", "utf8");

    expect(runWiki(["create-feature", "gated", "active feature"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-001", "active prd"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "gated", "future feature"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-002", "future prd"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "active slice", "--prd", "PRD-001", "--source", "src/current.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "gated", "specs/prds/PRD-002-future-prd.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "gated", "specs/features/FEAT-002-future-feature.md", "src/payments.ts"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 99\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(99))\n", "utf8");

    const closeout = runWiki(["closeout", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(closeout.exitCode).toBe(0);
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    expect(closeoutJson.ok).toBe(true);
    expect(closeoutJson.refreshFromGit.uncoveredFiles).not.toContain("src/payments.ts");
    expect(closeoutJson.outsideActiveHierarchyFiles).toContain("src/payments.ts");
    expect(closeoutJson.warnings.some((w: string) => w.includes("outside the active slice hierarchy"))).toBe(true);
  });

  test("worktree closeout treats files covered only by done-slice pages as uncovered", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "old payments work", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["complete-task", "gated", "GATED-001"], env).exitCode).toBe(0);
    expect(runWiki(["maintain", "gated", "--repo", repo, "--base", "HEAD~1", "--repair-done-slices"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 99\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(99))\n", "utf8");

    const maintain = runWiki(["maintain", "gated", "--repo", repo, "--worktree", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(maintainJson.refreshFromGit.uncoveredFiles).toContain("src/payments.ts");
    expect(maintainJson.refreshFromGit.suppressedPages.length).toBeGreaterThan(0);
    expect(maintainJson.refreshFromGit.impactedPages.every((p: { page: string }) => !p.page.includes("specs/slices/GATED-001"))).toBe(true);
  });

  test("refresh-on-merge is CI-friendly and supports verbose output", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "modules/payments/spec", "code-verified"], env).exitCode).toBe(0);

    const jsonResult = runWiki(["refresh-on-merge", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(jsonResult.exitCode).toBe(0);
    const json = JSON.parse(jsonResult.stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.impactedPages[0].page).toBe("modules/payments/spec.md");

    const verbose = runWiki(["refresh-on-merge", "gated", "--repo", repo, "--base", "HEAD~1", "--verbose"], env);
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdout.toString()).toContain("impacted: modules/payments/spec.md");
  });

  test("verify-page preserves stronger verification levels unless downgrade is explicit", () => {
    const vault = tempDir("wiki-vault");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "verification retention"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "demo", "specs/slices/DEMO-001/test-plan.md", "test-verified"], env).exitCode).toBe(0);

    const before = readFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md"), "utf8");
    expect(before).toContain("verification_level: test-verified");

    const bulkResult = runWiki(["verify-page", "demo", "--all", "code-verified"], env);
    expect(bulkResult.exitCode).toBe(0);
    expect(bulkResult.stdout.toString()).toContain("skipped projects/demo/specs/slices/DEMO-001/test-plan.md (kept stronger verification_level: test-verified)");

    const singleResult = runWiki(["verify-page", "demo", "specs/slices/DEMO-001/test-plan.md", "code-verified"], env);
    expect(singleResult.exitCode).toBe(0);
    expect(singleResult.stdout.toString()).toContain("kept stronger verification_level: test-verified");

    const preserved = readFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md"), "utf8");
    expect(preserved).toContain("verification_level: test-verified");

    const downgradeResult = runWiki(["verify-page", "demo", "--allow-downgrade", "specs/slices/DEMO-001/test-plan.md", "code-verified"], env);
    expect(downgradeResult.exitCode).toBe(0);

    const after = readFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md"), "utf8");
    expect(after).toContain("verification_level: code-verified");
    const summary = readFileSync(join(vault, "projects", "demo", "_summary.md"), "utf8");
    expect(summary).toContain("verification_level: code-verified");
  });
});
