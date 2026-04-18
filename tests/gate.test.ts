import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("gate diagnostics", () => {
  test("keeps project debt visible as project-scoped warnings", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "ad-hoc.md"), "# nope\n", "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "project" && finding.severity === "warning" && finding.message.includes("repo markdown doc"))).toBe(true);
  });

  test("surfaces parent-scoped warnings for hierarchy drift", () => {
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
    writeFileSync(slicePath, readFileSync(slicePath, "utf8").replace("status: draft", "status: done\nverification_level: code-verified"), "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "parent" && finding.severity === "warning" && finding.message.includes("computed="))).toBe(true);
  });
});
