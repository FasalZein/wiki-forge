import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki config init/validate/explain", () => {
  test("init writes a discoverable project config", () => {
    const repo = tempDir("wiki-config-init");
    const result = runWiki(["config", "init", "--repo", repo], { HOME: repo });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(repo, "wiki.config.jsonc"))).toBe(true);
  });

  test("validate accepts a config that only adds repo ignores", () => {
    const repo = tempDir("wiki-config-validate");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "repo": { "ignore": ["docs/generated/**"] } }`, "utf8");
    const result = runWiki(["config", "validate", "--repo", repo, "--json"], { HOME: repo });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString()).ok).toBe(true);
  });

  test("explain reports the effective value and source for a leaf", () => {
    const repo = tempDir("wiki-config-explain");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "repo": { "ignore": ["docs/generated/**"] } }`, "utf8");
    const result = runWiki(["config", "explain", "repo.ignore", "--repo", repo, "--json"], { HOME: repo });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.source).toBe("project");
    expect(parsed.value).toContain("node_modules/**");
    expect(parsed.value).toContain("docs/generated/**");
  });
});
