import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveForgeCommand } from "../../src/forge";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice() {
  const vault = tempDir("wiki-tdd-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---
title: ${sliceId} test slice
type: forge-slice
project: demo
task_id: ${sliceId}
status: in-progress
claimed_by: codex
claimed_at: '2026-04-28T05:00:00.000Z'
---
# ${sliceId}
`, "utf8");
  return vault;
}

function evidence(vault: string) {
  const raw = readFileSync(join(vault, "projects", "demo", "forge", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data.forge_evidence;
}

describe("forge tdd command adapters", () => {
  test("resolver maps forge tdd commands", () => {
    expect(resolveForgeCommand(["tdd", "red", "demo", sliceId])).toEqual({
      command: "forge:tdd",
      args: ["red", "demo", sliceId],
    });
  });

  test("red and green append strict typed TDD records", () => {
    const vault = createVaultWithSlice();
    const command = "bun test tests/forge-kernel/x.test.ts";

    const red = runWiki(["forge", "tdd", "red", "demo", sliceId, "--test", "tests/forge-kernel/x.test.ts", "--command", command, "--note", "expected failure", "--json"], { vault });
    expect(red.exitCode).toBe(0);
    expect(red.json()).toMatchObject({ kind: "tdd", phase: "red", command, testPaths: ["tests/forge-kernel/x.test.ts"], result: "failed", note: "expected failure" });

    const green = runWiki(["forge", "tdd", "green", "demo", sliceId, "--test", "tests/forge-kernel/x.test.ts", "--command", command, "--note", "passes now", "--json"], { vault });
    expect(green.exitCode).toBe(0);
    expect(green.json()).toMatchObject({ kind: "tdd", phase: "green", command, testPaths: ["tests/forge-kernel/x.test.ts"], result: "passed", note: "passes now" });
    expect(evidence(vault)).toMatchObject([
      { kind: "tdd", phase: "red", command, testPaths: ["tests/forge-kernel/x.test.ts"], result: "failed" },
      { kind: "tdd", phase: "green", command, testPaths: ["tests/forge-kernel/x.test.ts"], result: "passed" },
    ]);
  });

  test("status exits non-zero until red and green are both present", () => {
    const vault = createVaultWithSlice();
    const blocked = runWiki(["forge", "tdd", "status", "demo", sliceId, "--json"], { vault });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.json()).toMatchObject({ status: "missing-red" });

    const command = "bun test tests/forge-kernel/x.test.ts";
    runWiki(["forge", "tdd", "red", "demo", sliceId, "--test", "tests/forge-kernel/x.test.ts", "--command", command], { vault });
    runWiki(["forge", "tdd", "green", "demo", sliceId, "--test", "tests/forge-kernel/x.test.ts", "--command", command], { vault });

    const passed = runWiki(["forge", "tdd", "status", "demo", sliceId, "--json"], { vault });
    expect(passed.exitCode).toBe(0);
    expect(passed.json()).toMatchObject({ status: "passed" });
  });
});
