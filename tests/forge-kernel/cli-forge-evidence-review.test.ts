import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveForgeCommand } from "../../src/forge";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice() {
  const vault = tempDir("wiki-evidence-vault");
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

describe("forge evidence/review command adapters", () => {
  test("resolver maps forge evidence and review commands", () => {
    expect(resolveForgeCommand(["evidence", "demo", sliceId, "verify"])).toEqual({
      command: "forge:evidence",
      args: ["demo", sliceId, "verify"],
    });
    expect(resolveForgeCommand(["review", "record", "demo", sliceId])).toEqual({
      command: "forge:review",
      args: ["record", "demo", sliceId],
    });
  });

  test("forge evidence rejects removed coarse TDD records", () => {
    const vault = createVaultWithSlice();
    const result = runWiki(["forge", "evidence", "demo", sliceId, "tdd", "--command", "bun test tests/forge-kernel/x.test.ts", "--result", "passed", "--json"], { vault });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Use 'verify' for targeted verification or 'wiki forge tdd red/green' for TDD evidence");
    expect(evidence(vault)).toBeUndefined();
  });

  test("forge targeted verification appends a typed verification record", () => {
    const vault = createVaultWithSlice();
    const result = runWiki(["forge", "evidence", "demo", sliceId, "verification", "--command", "bun run check", "--verification-type", "targeted", "--result", "passed", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" });
    expect(evidence(vault)).toMatchObject([
      { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" },
    ]);
  });

  test("forge review record appends typed review evidence without changing status", () => {
    const vault = createVaultWithSlice();
    const result = runWiki(["forge", "review", "record", "demo", sliceId, "--verdict", "approved", "--reviewer", "reviewer", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "review", reviewer: "reviewer", verdict: "approved" });
    expect(evidence(vault)).toMatchObject([
      { kind: "review", reviewer: "reviewer", verdict: "approved" },
    ]);
    const raw = readFileSync(join(vault, "projects", "demo", "forge", "slices", sliceId, "index.md"), "utf8");
    expect(raw).toContain("status: in-progress");
  });
});
