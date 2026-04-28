import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-v1-handover-vault");
  initVault(vault);
  return vault;
}

describe("V1 typed handover command", () => {
  test("top-level handover routes to V1 typed handover instead of legacy session handover", () => {
    expect(resolveWikiCommand(["handover", "demo"]).command).toBe("v1:handover");
    expect(resolveWikiCommand(["v1", "handover", "demo"]).command).toBe("v1:handover");
  });

  test("writes structured forge handover with copy/paste prompt", () => {
    const vault = createVault();
    const result = runWiki([
      "handover",
      "demo",
      "--session",
      "2026-04-28-demo",
      "--agent",
      "pi",
      "--feature",
      "FEAT-V1-001",
      "--prd",
      "PRD-V1-001",
      "--slice",
      "DEMO-001",
      "--summary",
      "Created V1 memory primitives.",
      "--next-action",
      "Implement the next V1 slice.",
      "--prompt",
      "Continue V1 without fallback.",
      "--json",
    ], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "written",
      project: "demo",
      path: "projects/demo/forge/handovers/2026-04-28-demo.md",
      handover: {
        kind: "handover",
        relatedFeatures: ["FEAT-V1-001"],
        relatedPrds: ["PRD-V1-001"],
        relatedSlices: ["DEMO-001"],
      },
    });

    const handoverPath = join(vault, "projects", "demo", "forge", "handovers", "2026-04-28-demo.md");
    expect(existsSync(handoverPath)).toBe(true);
    const markdown = readFileSync(handoverPath, "utf8");
    expect(markdown).toContain("type: forge-handover");
    expect(markdown).toContain("related_features:");
    expect(markdown).toContain("## Copy/paste prompt for next session");
    expect(markdown).toContain("Continue V1 without fallback.");
  });
});
