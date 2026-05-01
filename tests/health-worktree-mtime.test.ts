import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isWorktreeSourceNewer } from "../src/health/shared/worktree-mtime";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => cleanupTempPaths());

describe("worktree source mtime comparison", () => {
  test("treats missing freshness metadata or missing files as stale", () => {
    const repo = tempDir("worktree-mtime-missing");

    expect(isWorktreeSourceNewer(repo, "src/missing.ts", null)).toBe(true);
    expect(isWorktreeSourceNewer(repo, "src/missing.ts", new Date("2026-05-01T00:00:00.000Z"))).toBe(true);
  });

  test("compares source file mtime against recorded update time", () => {
    const repo = tempDir("worktree-mtime");
    const sourcePath = join(repo, "src/example.ts");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(sourcePath, "export const value = 1;\n", "utf8");

    expect(isWorktreeSourceNewer(repo, "src/example.ts", new Date(Date.now() - 60_000))).toBe(true);
    expect(isWorktreeSourceNewer(repo, "src/example.ts", new Date(Date.now() + 60_000))).toBe(false);
  });
});
