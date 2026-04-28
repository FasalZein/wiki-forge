import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { shouldUseV1ForgeNext, shouldUseV1ForgeStatus } from "../../src/slice/forge";
import { describeLegacyCommand } from "../../src/v1/cli/legacy-compat";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice(status: "draft" | "ready" | "in-progress" | "done") {
  const vault = tempDir("wiki-v1-cutover-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "specs", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---
title: DEMO-001 first slice
type: spec
spec_kind: task-hub
project: demo
task_id: DEMO-001
status: ${status}
---
# DEMO-001
`, "utf8");
  return vault;
}

describe("legacy forge read-only V1 cutover", () => {
  test("wiki forge next defaults to V1 projection JSON", () => {
    const vault = createVaultWithSlice("ready");
    const legacyDefault = runWiki(["forge", "next", "demo", "--json"], { vault });
    const explicitV1 = runWiki(["v1", "forge", "next", "demo", "--json"], { vault });

    expect(legacyDefault.exitCode).toBe(0);
    expect(explicitV1.exitCode).toBe(0);
    expect(legacyDefault.json()).toEqual(explicitV1.json());
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

  test("wiki forge status project-level defaults to V1 projection JSON", () => {
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

  test("legacy escape hatches keep old prompt all and slice-specific paths available", () => {
    expect(shouldUseV1ForgeNext(["demo", "--json"])).toBe(true);
    expect(shouldUseV1ForgeNext(["demo", "--legacy", "--json"])).toBe(false);
    expect(shouldUseV1ForgeNext(["demo", "--prompt-json"])).toBe(false);
    expect(shouldUseV1ForgeNext(["demo", "--all", "--prompt-json"])).toBe(false);

    expect(shouldUseV1ForgeStatus(["demo", "--json"])).toBe(true);
    expect(shouldUseV1ForgeStatus(["demo", "DEMO-001", "--json"])).toBe(false);
    expect(shouldUseV1ForgeStatus(["demo", "--legacy", "--json"])).toBe(false);
  });

  test("compat metadata documents cutover", () => {
    expect(describeLegacyCommand("wiki forge next")).toEqual({
      command: "wiki forge next",
      status: "v1-compatible",
      replacement: "wiki v1 forge next",
      reason: "default read-only command routes to V1; use --legacy for old diagnostics",
    });
  });
});
