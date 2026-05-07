import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-handover-vault");
  initVault(vault);
  return vault;
}

describe("Forge typed handover command", () => {
  test("top-level handover routes to Forge typed handover instead of removed session handover", () => {
    expect(resolveWikiCommand(["handover", "demo"]).command).toBe("handover");
    expect(resolveWikiCommand(["agent-handover", "demo"]).command).toBe("handover");
  });

  test("writes durable forge handover and returns user-facing next-session prompt", () => {
    const vault = createVault();
    const result = runWiki([
      "handover",
      "demo",
      "--session",
      "2026-04-28-demo",
      "--agent",
      "pi",
      "--feature",
      "FEAT-001",
      "--prd",
      "PRD-001",
      "--slice",
      "DEMO-001",
      "--summary",
      "Created Forge memory primitives.",
      "--next-action",
      "Implement the next Forge slice.",
      "--command",
      "wiki forge status demo DEMO-001 --repo . --json",
      "--command",
      "bun test tests/demo.test.ts --timeout 1000",
      "--prompt",
      "Continue Forge without fallback.",
      "--json",
    ], { vault });

    expect(result.exitCode).toBe(0);
    const payload = result.json();
    expect(payload).toMatchObject({
      status: "written",
      project: "demo",
      path: "projects/demo/forge/handovers/2026-04-28-demo.md",
      handover: {
        kind: "handover",
        relatedFeatures: ["FEAT-001"],
        relatedPrds: ["PRD-001"],
        relatedSlices: ["DEMO-001"],
        copyPastePrompt: "Continue Forge without fallback.",
        runbookCommands: [
          "wiki forge status demo DEMO-001 --repo . --json",
          "bun test tests/demo.test.ts --timeout 1000",
        ],
      },
    });
    expect(payload.nextSessionPrompt).toContain("Session summary:");
    expect(payload.nextSessionPrompt).toContain("Operator prompt:\nContinue Forge without fallback.");
    expect(payload.nextSessionPrompt).toContain("Then run the handover runbook commands in order:");
    expect(payload.nextSessionPrompt).toContain("bun test tests/demo.test.ts --timeout 1000");

    const handoverPath = join(vault, "projects", "demo", "forge", "handovers", "2026-04-28-demo.md");
    expect(existsSync(handoverPath)).toBe(true);
    const markdown = readFileSync(handoverPath, "utf8");
    expect(markdown).toContain("type: forge-handover");
    expect(markdown).toContain("related_features:");
    expect(markdown).toContain("## Context refresh required");
    expect(markdown).toContain("wiki query --bm25 'demo latest decisions architecture handover'");
    expect(markdown).toContain("wiki query --bm25 'demo DEMO-001'");
    expect(markdown).toContain("wiki query --bm25 'demo PRD-001'");
    expect(markdown).toContain("## Runbook commands");
    expect(markdown).toContain("- `wiki forge status demo DEMO-001 --repo . --json`");
    expect(markdown).toContain("- `bun test tests/demo.test.ts --timeout 1000`");
    expect(markdown).toContain("## Operator prompt");
    expect(markdown).toContain("Continue Forge without fallback.");
    expect(markdown).not.toContain("## Copy/paste prompt for next session");
    expect(markdown).not.toContain("Session summary:");
  });
});
