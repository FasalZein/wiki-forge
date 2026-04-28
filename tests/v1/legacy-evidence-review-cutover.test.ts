import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { shouldUseV1ForgeEvidence, shouldUseV1ForgeReview } from "../../src/slice/forge";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-v1-evidence-cutover-vault");
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
  return matter(raw).data.v1_evidence;
}

describe("legacy evidence/review V1 cutover", () => {
  test("implemented evidence/review commands do not fall back to legacy", () => {
    expect(shouldUseV1ForgeEvidence(["demo", sliceId, "tdd", "--command", "bun test", "--json"])).toBe(true);
    expect(shouldUseV1ForgeEvidence(["demo", sliceId, "tdd", "--legacy", "--command", "bun test"])).toBe(true);
    expect(shouldUseV1ForgeReview(["record", "demo", sliceId, "--verdict", "approved", "--reviewer", "reviewer"])).toBe(true);
    expect(shouldUseV1ForgeReview(["record", "demo", sliceId, "--legacy", "--verdict", "approved", "--reviewer", "reviewer"])).toBe(true);
  });

  test("default wiki forge evidence tdd routes to V1", () => {
    const vault = createVault();
    const result = runWiki(["forge", "evidence", "demo", sliceId, "tdd", "--command", "bun test tests/v1/x.test.ts", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "tdd", command: "bun test tests/v1/x.test.ts", result: "passed" });
    expect(evidence(vault)).toMatchObject([{ kind: "tdd", command: "bun test tests/v1/x.test.ts", result: "passed" }]);
  });

  test("default wiki forge evidence verify routes to V1 targeted verification", () => {
    const vault = createVault();
    const result = runWiki(["forge", "evidence", "demo", sliceId, "verify", "--command", "bun run check", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" });
    expect(evidence(vault)).toMatchObject([{ kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed" }]);
  });

  test("default wiki forge review record routes to V1", () => {
    const vault = createVault();
    const result = runWiki(["forge", "review", "record", "demo", sliceId, "--verdict", "approved", "--reviewer", "reviewer", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ kind: "review", reviewer: "reviewer", verdict: "approved" });
    expect(evidence(vault)).toMatchObject([{ kind: "review", reviewer: "reviewer", verdict: "approved" }]);
  });
});
