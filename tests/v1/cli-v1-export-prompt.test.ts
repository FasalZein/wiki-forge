import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-v1-export-prompt-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---\ntitle: DEMO-001 ready slice\ntype: forge-slice\nproject: demo\ntask_id: DEMO-001\nstatus: ready\n---\n# DEMO-001\n`, "utf8");
  const handoverDir = join(vault, "projects", "demo", "forge", "handovers");
  mkdirSync(handoverDir, { recursive: true });
  writeFileSync(join(handoverDir, "2026-04-28-demo.md"), `---\ntitle: Demo handover\nproject: demo\ntype: forge-handover\nsession_id: 2026-04-28-demo\ncreated_at: '2026-04-28T00:00:00.000Z'\nagent: pi\nrelated_features:\n  - FEAT-V1-001\nrelated_prds:\n  - PRD-V1-001\nrelated_slices:\n  - DEMO-001\nnext_action: Start ready slice.\n---\n# Demo handover\n\n## Summary\n\nReady for implementation.\n\n## Copy/paste prompt for next session\n\n\`\`\`text\nContinue demo V1.\n\`\`\`\n`, "utf8");
  return vault;
}

describe("V1 export prompt", () => {
  test("top-level export-prompt routes to V1 prompt packet", () => {
    expect(resolveWikiCommand(["export-prompt", "demo"]).command).toBe("v1:export-prompt");
    expect(resolveWikiCommand(["v1", "export-prompt", "demo"]).command).toBe("v1:export-prompt");
  });

  test("renders a copy/paste prompt packet from V1 handover and Forge status", () => {
    const vault = createVault();
    const result = runWiki(["export-prompt", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      kind: "v1-prompt-packet",
      project: "demo",
      nextAction: "start-ready-slice",
      statusTruth: {
        status: "ready",
        nextSliceId: "DEMO-001",
      },
      latestHandover: {
        sessionId: "2026-04-28-demo",
      },
    });
    expect(result.json().prompt).toContain("We are continuing demo.");
    expect(result.json().prompt).toContain("Next action: start-ready-slice");
    expect(result.json().prompt).toContain("Ready slice: DEMO-001");
    expect(result.json().prompt).toContain("Previous handover prompt:");
    expect(result.json().prompt).toContain("Continue demo V1.");
  });
});
