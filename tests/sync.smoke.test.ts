import { afterEach, describe, expect, test } from "bun:test";
import { runWiki, cleanupTempPaths, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki sync smoke", () => {
  test("sync command reports scoped reconciliation work as JSON", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["sync", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.project).toBe("demo");
    expect(typeof json.reportOnly).toBe("boolean");
    expect(Array.isArray(json.dirtyPages)).toBe(true);
    expect(Array.isArray(json.navigation.staleTargets)).toBe(true);
    expect(Array.isArray(json.protocol.targets)).toBe(true);
  });
});
