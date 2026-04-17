import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const SRC = resolve(REPO_ROOT, "src");

describe("WIKI-FORGE-116 import cycles", () => {
  test("madge reports zero circular imports under src/", () => {
    const proc = Bun.spawnSync({
      cmd: ["bunx", "madge", "--circular", "--extensions", "ts", SRC],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    const combined = stdout + stderr;
    if (proc.exitCode !== 0) {
      throw new Error(`madge reported cycles (exit ${proc.exitCode}):\n${combined}`);
    }
    expect(combined).toContain("No circular dependency found");
  });
});
