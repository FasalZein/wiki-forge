import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice() {
  const vault = tempDir("wiki-review-session-vault");
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

function frontmatter(vault: string) {
  const raw = readFileSync(join(vault, "projects", "demo", "forge", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data;
}

describe("Forge review session CLI", () => {
  test("review start opens a subagent review session without recording approval evidence", () => {
    const vault = createVaultWithSlice();

    const result = runWiki(["forge", "review", "start", "demo", sliceId, "--reviewer", "reviewer-subagent", "--mode", "subagent", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "in-review", reviewer: "reviewer-subagent", mode: "subagent" });
    const data = frontmatter(vault);
    expect(data.forge_review_session).toMatchObject({ status: "in-review", reviewer: "reviewer-subagent", mode: "subagent" });
    expect(data.forge_evidence).toBeUndefined();
  });

  test("review record completes the active review session and appends canonical evidence", () => {
    const vault = createVaultWithSlice();
    runWiki(["forge", "review", "start", "demo", sliceId, "--reviewer", "reviewer-subagent", "--mode", "subagent", "--json"], { vault });

    const result = runWiki(["forge", "review", "record", "demo", sliceId, "--verdict", "approved", "--reviewer", "reviewer-subagent", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    const data = frontmatter(vault);
    expect(data.forge_review_session).toMatchObject({ status: "approved", reviewer: "reviewer-subagent", mode: "subagent" });
    expect(data.forge_evidence).toMatchObject([{ kind: "review", reviewer: "reviewer-subagent", verdict: "approved" }]);
  });
});
