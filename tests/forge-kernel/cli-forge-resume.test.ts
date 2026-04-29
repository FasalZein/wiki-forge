import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-resume-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---\ntitle: ${sliceId} first slice\ntype: forge-slice\nproject: demo\ntask_id: ${sliceId}\nstatus: in-progress\n---\n# ${sliceId}\n`, "utf8");
  const handoverDir = join(vault, "projects", "demo", "forge", "handovers");
  mkdirSync(handoverDir, { recursive: true });
  writeFileSync(join(handoverDir, "2026-04-28-demo.md"), `---\ntitle: Demo handover\nproject: demo\ntype: forge-handover\nsession_id: 2026-04-28-demo\ncreated_at: '2026-04-28T00:00:00.000Z'\nagent: pi\nrelated_slices:\n  - ${sliceId}\nnext_action: Continue the active slice.\n---\n# Demo handover\n\n## Summary\n\nCreated Forge resume state.\n\n## Copy/paste prompt for next session\n\n\`\`\`text\nContinue demo Forge.\n\`\`\`\n`, "utf8");
  return vault;
}

describe("Forge resume", () => {
  test("top-level resume routes to Forge resume instead of legacy session resume", () => {
    expect(resolveWikiCommand(["resume", "demo"]).command).toBe("resume");
  });

  test("returns latest typed handover and forge status without repo/base requirements", () => {
    const vault = createVault();
    const result = runWiki(["resume", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      kind: "forge-resume",
      project: "demo",
      mutatesLifecycle: false,
      statusTruth: {
        status: "active",
        activeSliceId: sliceId,
        source: "canonical-records",
      },
      latestHandover: {
        path: "projects/demo/forge/handovers/2026-04-28-demo.md",
        sessionId: "2026-04-28-demo",
        relatedSlices: [sliceId],
        copyPastePrompt: "Continue demo Forge.",
      },
      nextAction: "continue-active-slice",
    });
  });
});
