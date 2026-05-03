import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { shouldUseForgeNext, shouldUseForgeStatus } from "../../src/forge/cutover";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice(status: "draft" | "ready" | "in-progress" | "done") {
  const vault = tempDir("wiki-cutover-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---
title: DEMO-001 first slice
type: forge-slice
project: demo
task_id: DEMO-001
status: ${status}
---
# DEMO-001
`, "utf8");
  return vault;
}

describe("removed read-only Forge cutover", () => {
  test("wiki forge next defaults to Forge projection JSON", () => {
    const vault = createVaultWithSlice("ready");
    const legacyDefault = runWiki(["forge", "next", "demo", "--json"], { vault });
    const explicitForge = runWiki(["forge", "next", "demo", "--json"], { vault });

    expect(legacyDefault.exitCode).toBe(0);
    expect(explicitForge.exitCode).toBe(0);
    expect(legacyDefault.json()).toEqual(explicitForge.json());
    expect(legacyDefault.json()).toMatchObject({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start demo DEMO-001",
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    });
  });

  test("wiki forge next returns release guidance when only draft slices exist", () => {
    const vault = createVaultWithSlice("draft");
    const result = runWiki(["forge", "next", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "drafts",
      project: "demo",
      nextAction: "release-draft-slice",
      nextCommand: "wiki forge release demo DEMO-001",
      reason: "Draft slices exist but must be released before start.",
      candidates: [{ sliceId: "DEMO-001", title: "DEMO-001 first slice", nextCommand: "wiki forge release demo DEMO-001" }],
      source: "canonical-records",
    });
  });

  test("wiki forge status project-level defaults to Forge projection JSON", () => {
    const vault = createVaultWithSlice("in-progress");
    const result = runWiki(["forge", "status", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "active",
      project: "demo",
      activeSliceId: "DEMO-001",
      nextAction: "continue-active-slice",
      nextCommand: "wiki forge status demo DEMO-001 --json",
      reason: "Active slice exists; inspect slice status and continue its gates.",
      source: "canonical-records",
    });
  });

  test("implemented read-only commands do not fall back to legacy", () => {
    expect(shouldUseForgeNext(["demo", "--json"])).toBe(true);
    expect(shouldUseForgeNext(["demo", "--json"])).toBe(true);
    expect(shouldUseForgeNext(["demo", "--prompt-json"])).toBe(false);
    expect(shouldUseForgeNext(["demo", "--all", "--prompt-json"])).toBe(false);

    expect(shouldUseForgeStatus(["demo", "--json"])).toBe(true);
    expect(shouldUseForgeStatus(["demo", "DEMO-001", "--json"])).toBe(true);
    expect(shouldUseForgeStatus(["demo", "--json"])).toBe(true);
  });

  test("compat metadata documents cutover", () => {
    expect(shouldUseForgeNext(["demo", "--json"])).toBe(true);
    expect(shouldUseForgeStatus(["demo", "--json"])).toBe(true);
  });
});
