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

describe("legacy forge read-only Forge cutover", () => {
  test("wiki forge next defaults to Forge projection JSON", () => {
    const vault = createVaultWithSlice("ready");
    const legacyDefault = runWiki(["forge", "next", "demo", "--json"], { vault });
    const explicitForge = runWiki(["forge", "next", "demo", "--json"], { vault });

    expect(legacyDefault.exitCode).toBe(0);
    expect(explicitForge.exitCode).toBe(0);
    expect(legacyDefault.json()).toEqual(explicitForge.json());
    expect(legacyDefault.json()).toEqual({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });
  });

  test("wiki forge next returns empty when only draft legacy slices exist", () => {
    const vault = createVaultWithSlice("draft");
    const result = runWiki(["forge", "next", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      status: "empty",
      project: "demo",
      nextAction: "plan-next-slice",
      source: "canonical-records",
    });
  });

  test("wiki forge status project-level defaults to Forge projection JSON", () => {
    const vault = createVaultWithSlice("in-progress");
    const result = runWiki(["forge", "status", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      status: "active",
      project: "demo",
      activeSliceId: "DEMO-001",
      nextAction: "continue-active-slice",
      source: "canonical-records",
    });
  });

  test("implemented read-only commands do not fall back to legacy", () => {
    expect(shouldUseForgeNext(["demo", "--json"])).toBe(true);
    expect(shouldUseForgeNext(["demo", "--legacy", "--json"])).toBe(true);
    expect(shouldUseForgeNext(["demo", "--prompt-json"])).toBe(false);
    expect(shouldUseForgeNext(["demo", "--all", "--prompt-json"])).toBe(false);

    expect(shouldUseForgeStatus(["demo", "--json"])).toBe(true);
    expect(shouldUseForgeStatus(["demo", "DEMO-001", "--json"])).toBe(true);
    expect(shouldUseForgeStatus(["demo", "--legacy", "--json"])).toBe(true);
  });

  test("compat metadata documents cutover", () => {
  });
});
