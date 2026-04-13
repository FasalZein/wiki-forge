import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki protocol commands", () => {
  test("protocol sync installs root files and preserves local notes below the managed block", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    writeFileSync(join(repo, "AGENTS.md"), "# Local Notes\n\nKeep this section.\n", "utf8");

    const result = runWiki(["protocol", "sync", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.files.some((row: { path: string }) => row.path === "AGENTS.md")).toBe(true);
    expect(json.files.some((row: { path: string }) => row.path === "CLAUDE.md")).toBe(true);

    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(agents).toContain("managed_by: wiki-forge");
    expect(agents).toContain("# Agent Protocol");
    expect(agents).toContain("wiki start-slice demo <slice-id>");
    expect(agents).toContain("# Local Notes");
    expect(claude).toContain("managed_by: wiki-forge");
    expect(claude).toContain("wiki close-slice demo <slice-id>");
  });

  test("protocol sync and audit support nested scopes declared in _summary frontmatter", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "apps", "api"), { recursive: true });
    const summaryPath = join(vault, "projects", "demo", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("verification_level: scaffold\n", "verification_level: scaffold\nprotocol_scopes:\n  - apps/api\n"), "utf8");

    expect(runWiki(["protocol", "sync", "demo", "--repo", repo], env).exitCode).toBe(0);
    expect(readFileSync(join(repo, "apps", "api", "AGENTS.md"), "utf8")).toContain("scope: apps/api");
    expect(readFileSync(join(repo, "apps", "api", "CLAUDE.md"), "utf8")).toContain("Scope: apps/api");

    const auditOk = runWiki(["protocol", "audit", "demo", "--repo", repo, "--json"], env);
    expect(auditOk.exitCode).toBe(0);
    expect(JSON.parse(auditOk.stdout.toString()).ok).toBe(true);

    unlinkSync(join(repo, "apps", "api", "CLAUDE.md"));
    const auditFail = runWiki(["protocol", "audit", "demo", "--repo", repo, "--json"], env);
    expect(auditFail.exitCode).toBe(1);
    const auditJson = JSON.parse(auditFail.stdout.toString());
    expect(auditJson.missing.some((row: { path: string }) => row.path === "apps/api/CLAUDE.md")).toBe(true);
  });

  test("onboard with --repo syncs root protocol files", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["onboard", "demo", "--repo", repo], env);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("managed_by: wiki-forge");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toContain("managed_by: wiki-forge");
  });
});
