import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki sync reconciler", () => {
  test("report-only mode scopes reconciliation to directly impacted derived targets", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["protocol", "sync", "demo", "--repo", repo], env).exitCode).toBe(0);

    const summaryPath = join(vault, "projects", "demo", "_summary.md");
    const summary = readFileSync(summaryPath, "utf8");
    writeFileSync(summaryPath, summary.replace("title: demo", "title: demo synced"), "utf8");

    const result = runWiki(["sync", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.reportOnly).toBe(true);
    expect(json.dirtyPages.some((page: { page: string }) => page.page === "_summary.md")).toBe(true);
    expect(json.writes.protocolTargets).toEqual([]);
    expect(json.writes.navigationTargets.length).toBeGreaterThan(0);
    expect(json.writes.total).toBeLessThan(10);
  });

  test("write mode applies only stale protocol render targets", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["protocol", "sync", "demo", "--repo", repo], env).exitCode).toBe(0);
    mkdirSync(join(repo, "apps", "api"), { recursive: true });

    const summaryPath = join(vault, "projects", "demo", "_summary.md");
    const summary = readFileSync(summaryPath, "utf8");
    writeFileSync(summaryPath, summary.replace("verification_level: scaffold", "verification_level: scaffold\nprotocol_scopes:\n  - apps/api"), "utf8");

    const result = runWiki(["sync", "demo", "--repo", repo, "--write", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.reportOnly).toBe(false);
    expect(json.writes.protocolTargets).toContain("apps/api/AGENTS.md");
    expect(json.writes.protocolTargets).toContain("apps/api/CLAUDE.md");
    expect(readFileSync(join(repo, "apps", "api", "AGENTS.md"), "utf8")).toContain("scope: apps/api");
    expect(readFileSync(join(repo, "apps", "api", "CLAUDE.md"), "utf8")).toContain("Scope: apps/api");
  });

  test("write mode refreshes stale project summary when repo changes impact _summary.md", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const summaryPath = join(vault, "projects", "demo", "_summary.md");
    const initialSummary = readFileSync(summaryPath, "utf8")
      .replace(`repo: ${repo}`, `repo: ${repo}\nsource_paths:\n  - src\n  - README.md\n  - package.json`)
      .replace("## Current Focus\n\n- \n", "## Current Focus\n\n- Keep this manual note\n");
    writeFileSync(summaryPath, initialSummary, "utf8");

    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");

    const result = runWiki(["sync", "demo", "--repo", repo, "--write", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.writes.projectTargets).toContain("_summary.md");

    const refreshedSummary = readFileSync(summaryPath, "utf8");
    expect(refreshedSummary).toContain("- Keep this manual note");
    expect(refreshedSummary).toContain("## Change Digest");
    expect(refreshedSummary).toContain("Updated from current worktree changes");
    expect(refreshedSummary).toContain("Source: `src`");

    const checkpoint = runWiki(["checkpoint", "demo", "--repo", repo, "--json"], env);
    expect(checkpoint.exitCode).toBe(0);
    const checkpointJson = JSON.parse(checkpoint.stdout.toString());
    expect(checkpointJson.stalePages).toEqual([]);
  });
});
