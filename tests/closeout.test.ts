import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("closeout diagnostics", () => {
  test("labels active-slice blockers with slice scope", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "demo", "modules/auth/spec", "code-verified"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");

    const result = runWiki(["closeout", "demo", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string }) => finding.scope === "slice" && finding.severity === "blocker")).toBe(true);
  });

  test("surfaces ambiguous lifecycle drift as parent-scoped R4 escalation warning", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-feature", "demo", "Alpha"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "Alpha"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "alpha slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const featurePath = join(vault, "projects", "demo", "specs", "features", "FEAT-001-alpha.md");
    const prdPath = join(vault, "projects", "demo", "specs", "prds", "PRD-001-alpha.md");
    const slicePath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");

    writeFileSync(featurePath, readFileSync(featurePath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(prdPath, readFileSync(prdPath, "utf8").replace("status: draft", "status: complete"), "utf8");
    // Slice is done but only code-verified (computed = needs-verification, not complete and not cancelled/non-terminal)
    // This triggers R4 escalation (not R2/R3) because no deterministic resolution applies
    writeFileSync(slicePath, readFileSync(slicePath, "utf8").replace("status: draft", "status: done\nverification_level: code-verified"), "utf8");

    const result = runWiki(["closeout", "demo", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    // R4 escalation: parent drift is surfaced with inverse commands
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) =>
      finding.scope === "parent" && finding.severity === "warning" && finding.message.includes("wiki lifecycle")
    )).toBe(true);
    expect(json.diagnostics.actionableWarnings.some((finding: { scope: string; message: string }) =>
      finding.scope === "parent" && finding.message.includes("wiki lifecycle")
    )).toBe(true);
  });

  test("reports exact unowned changed files for slice-local closeout", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "payments slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "outside.ts"), "export const outside = 1\n", "utf8");

    const result = runWiki(["closeout", "demo", "--repo", repo, "--worktree", "--slice-local", "--slice-id", "DEMO-001", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());

    expect(json.findings.some((finding: { scope: string; severity: string; message: string; files?: string[] }) =>
      finding.scope === "history"
      && finding.severity === "blocker"
      && finding.message === "1 changed file(s) are unowned by the active slice"
      && JSON.stringify(finding.files) === JSON.stringify(["src/outside.ts"])
    )).toBe(true);
  });

  test("groups historical warning noise separately from actionable warnings", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "active payments work", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "future payments work", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");

    const result = runWiki(["closeout", "demo", "--repo", repo, "--worktree", "--json"], env);
    const json = JSON.parse(result.stdout.toString());

    expect(json.diagnostics.historicalWarnings.some((finding: { scope: string; message: string }) =>
      finding.scope === "history" && finding.message.includes("non-actionable planning page")
    )).toBe(true);
    expect(json.diagnostics.actionableWarnings.some((finding: { message: string }) =>
      finding.message.includes("non-actionable planning page")
    )).toBe(false);
  });
});
