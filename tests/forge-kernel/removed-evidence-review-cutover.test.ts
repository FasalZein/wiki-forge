import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-evidence-cutover-vault");
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

describe("removed evidence/review Forge cutover", () => {
  test("default wiki forge evidence tdd is removed", () => {
    const vault = createVault();
    const result = runWiki(["forge", "evidence", "demo", sliceId, "tdd", "--command", "bun test tests/forge-kernel/x.test.ts", "--json"], { vault });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Use 'verify' for targeted verification or 'wiki forge tdd cycle' for TDD evidence");
    expect(evidence(vault)).toBeUndefined();
  });

  test("default wiki forge evidence verify routes to Forge targeted verification", () => {
    const vault = createVault();
    const result = runWiki(["forge", "evidence", "demo", sliceId, "verify", "--command", "bun run check", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" });
    expect(evidence(vault)).toMatchObject([{ kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" }]);
  });

  test("default wiki forge review record routes to Forge", () => {
    const vault = createVault();
    const result = runWiki(["forge", "review", "record", "demo", sliceId, "--verdict", "approved", "--reviewer", "reviewer", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "review", reviewer: "reviewer", verdict: "approved" });
    expect(evidence(vault)).toMatchObject([{ kind: "review", reviewer: "reviewer", verdict: "approved" }]);
  });
});
