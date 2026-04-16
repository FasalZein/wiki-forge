import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("maintain + closeout auto-refresh navigation index (WIKI-FORGE-105)", () => {
  test("maintain auto-rewrites stale workspace index and reports it", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autoidx"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autoidx");

    // Corrupt the spec index to force staleness
    const specIndex = join(vault, "projects", "autoidx", "specs", "index.md");
    const raw = readFileSync(specIndex, "utf8");
    writeFileSync(specIndex, raw.replace(/^# .*$/m, "# STALE HEADING"), "utf8");

    const maintain = runWiki(["maintain", "autoidx", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(maintainJson.indexRefresh.stale).toContain("projects/autoidx/specs/index.md");
    expect(maintainJson.indexRefresh.written).toContain("projects/autoidx/specs/index.md");

    // After rewrite the correct heading should be back
    expect(readFileSync(specIndex, "utf8")).toContain("# autoidx Index");
  });

  test("maintain --dry-run reports stale but does not write", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autoidx2"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autoidx2");

    const specIndex = join(vault, "projects", "autoidx2", "specs", "index.md");
    const raw = readFileSync(specIndex, "utf8");
    writeFileSync(specIndex, raw.replace(/^# .*$/m, "# STALE HEADING"), "utf8");

    const maintain = runWiki(["maintain", "autoidx2", "--repo", repo, "--base", "HEAD~1", "--dry-run", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(maintainJson.indexRefresh.stale.length).toBeGreaterThan(0);
    expect(maintainJson.indexRefresh.written).toHaveLength(0);

    // Stale heading remains
    expect(readFileSync(specIndex, "utf8")).toContain("# STALE HEADING");
  });

  test("closeout auto-refreshes navigation index on entry", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autoidx3"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autoidx3");

    const specIndex = join(vault, "projects", "autoidx3", "specs", "index.md");
    const raw = readFileSync(specIndex, "utf8");
    writeFileSync(specIndex, raw.replace(/^# .*$/m, "# STALE HEADING"), "utf8");

    const closeout = runWiki(["closeout", "autoidx3", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    // closeout may fail on other signals; we just care about indexRefresh presence
    const closeoutJson = JSON.parse(closeout.stdout.toString());
    expect(closeoutJson.indexRefresh).toBeDefined();
    expect(closeoutJson.indexRefresh.written).toContain("projects/autoidx3/specs/index.md");
    expect(readFileSync(specIndex, "utf8")).toContain("# autoidx3 Index");
  });

  test("maintain reports 'up to date' when navigation indexes are fresh", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autoidx4"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autoidx4");
    // Run update-index once so everything is current
    expect(runWiki(["update-index", "autoidx4", "--write"], env).exitCode).toBe(0);

    const maintain = runWiki(["maintain", "autoidx4", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(maintainJson.indexRefresh.stale).toHaveLength(0);
    expect(maintainJson.indexRefresh.written).toHaveLength(0);

    // Text mode reports "up to date"
    const maintainText = runWiki(["maintain", "autoidx4", "--repo", repo, "--base", "HEAD~1"], env);
    expect(maintainText.exitCode).toBe(0);
    expect(maintainText.stdout.toString()).toContain("index refresh: up to date");
  });

  test("auto-refresh only lists navigation index paths as stale, not content pages", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autoidx5"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "autoidx5");
    expect(runWiki(["create-module", "autoidx5", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "autoidx5", "auth platform"], env).exitCode).toBe(0);

    // Force a stale navigation index to trigger auto-refresh
    const specIndex = join(vault, "projects", "autoidx5", "specs", "index.md");
    const raw = readFileSync(specIndex, "utf8");
    writeFileSync(specIndex, raw.replace(/^# .*$/m, "# STALE HEADING"), "utf8");

    const maintain = runWiki(["maintain", "autoidx5", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());

    // Module, feature, prd, and slice content pages must never appear as
    // navigation-index staleness entries — only true index files.
    const isNav = (p: string) =>
      p === "index.md" ||
      p === "projects/_dashboard.md" ||
      /^projects\/[^/]+\/specs\/index\.md$/u.test(p) ||
      /^projects\/[^/]+\/specs\/(features|prds|slices|archive)\/index\.md$/u.test(p);
    for (const entry of maintainJson.indexRefresh.stale) expect(isNav(entry)).toBe(true);
    for (const entry of maintainJson.indexRefresh.written) expect(isNav(entry)).toBe(true);
  });
});
