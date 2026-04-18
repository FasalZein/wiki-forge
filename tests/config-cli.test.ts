import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki config --effective", () => {
  test("zero-config repo: every leaf annotated 'default'", () => {
    const repo = tempDir("wiki-config-cli-empty");
    const result = runWiki(["config", "--effective", "--repo", repo], { HOME: repo });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("repo.ignore");
    expect(out).toContain("default");
    expect(out).not.toContain("project");
  });

  test("--json emits valid JSON with per-leaf source fields", () => {
    const repo = tempDir("wiki-config-cli-json");
    const result = runWiki(["config", "--effective", "--json", "--repo", repo], { HOME: repo });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.repo.ignore.source).toBe("default");
    expect(parsed.repo.ignore.value).toEqual([]);
  });

  test("project config annotates configured leaf as 'project'", () => {
    const repo = tempDir("wiki-config-cli-project");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "repo": { "ignore": ["docs/**"] } }`, "utf8");
    const result = runWiki(["config", "--effective", "--json", "--repo", repo], { HOME: repo });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.repo.ignore.source).toBe("project");
    expect(parsed.repo.ignore.value).toEqual(["docs/**"]);
  });

  test("malformed jsonc exits 1 with parse error containing file path", () => {
    const repo = tempDir("wiki-config-cli-bad");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "repo": { "ignore": [`, "utf8");
    const result = runWiki(["config", "--effective", "--repo", repo], { HOME: repo });
    expect(result.exitCode).toBe(1);
    const stderr = result.stderr.toString();
    expect(stderr).toContain(join(repo, "wiki.config.jsonc"));
  });
});
