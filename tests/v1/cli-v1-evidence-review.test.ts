import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice() {
  const vault = tempDir("wiki-v1-evidence-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "specs", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---
title: ${sliceId} test slice
type: spec
spec_kind: task-hub
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
  const raw = readFileSync(join(vault, "projects", "demo", "specs", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data.v1_evidence;
}

describe("v1 evidence/review command adapters", () => {
  test("resolver maps v1 evidence and review commands", () => {
    expect(resolveWikiCommand(["v1", "forge", "evidence", "demo", sliceId, "tdd"])).toEqual({
      command: "v1:forge:evidence",
      args: ["demo", sliceId, "tdd"],
    });
    expect(resolveWikiCommand(["v1", "forge", "review", "record", "demo", sliceId])).toEqual({
      command: "v1:forge:review",
      args: ["record", "demo", sliceId],
    });
  });

  test("v1 tdd evidence appends a typed evidence record", () => {
    const vault = createVaultWithSlice();
    const result = runWiki(["v1", "forge", "evidence", "demo", sliceId, "tdd", "--command", "bun test tests/v1/x.test.ts", "--result", "passed", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "tdd", command: "bun test tests/v1/x.test.ts", result: "passed" });
    expect(evidence(vault)).toMatchObject([
      { kind: "tdd", command: "bun test tests/v1/x.test.ts", result: "passed" },
    ]);
  });

  test("v1 targeted verification appends a typed verification record", () => {
    const vault = createVaultWithSlice();
    const result = runWiki(["v1", "forge", "evidence", "demo", sliceId, "verification", "--command", "bun run check", "--verification-type", "targeted", "--result", "passed", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" });
    expect(evidence(vault)).toMatchObject([
      { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" },
    ]);
  });

  test("v1 review record appends typed review evidence without changing status", () => {
    const vault = createVaultWithSlice();
    const result = runWiki(["v1", "forge", "review", "record", "demo", sliceId, "--verdict", "approved", "--reviewer", "reviewer", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "review", reviewer: "reviewer", verdict: "approved" });
    expect(evidence(vault)).toMatchObject([
      { kind: "review", reviewer: "reviewer", verdict: "approved" },
    ]);
    const raw = readFileSync(join(vault, "projects", "demo", "specs", "slices", sliceId, "index.md"), "utf8");
    expect(raw).toContain("status: in-progress");
  });
});
