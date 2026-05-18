import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setupVaultAndRepo, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-export-prompt-vault");
  initVault(vault);
  writeReadySlice(vault);
  const handoverDir = join(vault, "projects", "demo", "forge", "handovers");
  mkdirSync(handoverDir, { recursive: true });
  writeFileSync(join(handoverDir, "2026-04-28-demo.md"), `---\ntitle: Demo handover\nproject: demo\ntype: forge-handover\nsession_id: 2026-04-28-demo\ncreated_at: '2026-04-28T00:00:00.000Z'\nagent: pi\nrelated_features:\n  - FEAT-001\nrelated_prds:\n  - PRD-001\nrelated_slices:\n  - DEMO-001\nnext_action: Start ready slice.\n---\n# Demo handover\n\n## Summary\n\nReady for implementation.\n\n## Copy/paste prompt for next session\n\n\`\`\`text\nContinue demo Forge.\n\`\`\`\n`, "utf8");
  return vault;
}

function writeReadySlice(vault: string) {
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---\ntitle: DEMO-001 ready slice\ntype: forge-slice\nproject: demo\ntask_id: DEMO-001\nstatus: ready\n---\n# DEMO-001\n`, "utf8");
}

function writeStaleHandover(vault: string, oldHead: string) {
  const handoverDir = join(vault, "projects", "demo", "forge", "handovers");
  mkdirSync(handoverDir, { recursive: true });
  writeFileSync(join(handoverDir, "2026-04-29-demo.md"), `---\ntitle: Demo handover\nproject: demo\ntype: forge-handover\nsession_id: 2026-04-29-demo\ncreated_at: '2026-04-29T00:00:00.000Z'\nagent: pi\nrelated_slices: []\nnext_action: Continue from stale prompt.\n---\n# Demo handover\n\n## Summary\n\nStale prompt.\n\n## Copy/paste prompt for next session\n\n\`\`\`text\nContinue demo from clean HEAD ${oldHead}.\n\`\`\`\n`, "utf8");
}

describe("Forge export prompt", () => {
  test("top-level export-prompt routes to Forge prompt packet", () => {
    expect(resolveWikiCommand(["export-prompt", "demo"]).command).toBe("export-prompt");
  });

  test("renders a copy/paste prompt packet from Forge handover and Forge status", () => {
    const vault = createVault();
    const result = runWiki(["export-prompt", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      kind: "prompt-packet",
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
    const prompt = result.json().prompt;
    expect(prompt).toContain("We are continuing demo.");
    expect(prompt).toContain("Do not reconstruct the prior conversation");
    expect(prompt).toContain("Minimal refresh:");
    expect(prompt).toContain("wiki checkpoint demo --repo <path> --base HEAD --json");
    expect(prompt).toContain("wiki forge next demo --repo <path> --json");
    expect(prompt).not.toContain("wiki query --bm25");
    expect(prompt).toContain("Next action: start-ready-slice");
    expect(prompt).toContain("Ready slice: DEMO-001");
    expect(prompt).toContain("Operator prompt from latest handover:");
    expect(prompt).toContain("Continue demo Forge.");
  });

  test("stale handover prompt is labeled historical and paired with current recovery prompt", () => {
    const { vault, repo } = setupVaultAndRepo();
    writeReadySlice(vault);
    const oldHead = runGit(repo, ["rev-list", "--max-parents=0", "HEAD"]).stdout.toString().trim();
    const currentHead = runGit(repo, ["rev-parse", "HEAD"]).stdout.toString().trim();
    writeStaleHandover(vault, oldHead);

    const result = runWiki(["export-prompt", "demo", "--repo", repo, "--base", "HEAD", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    const packet = result.json();
    expect(packet.handoverStaleness).toMatchObject({ status: "stale", promptHead: oldHead, currentHead });
    expect(packet.recoveryPrompt).toContain(`current HEAD ${currentHead}`);
    expect(packet.prompt).toContain("Do not reconstruct the prior conversation");
    expect(packet.prompt).toContain("Minimal refresh:");
    expect(packet.prompt).not.toContain("wiki query --bm25");
    expect(packet.prompt).toContain("Operator prompt from latest handover (stale; context only):");
    expect(packet.prompt).toContain(`Continue demo from clean HEAD ${oldHead}.`);
    expect(packet.prompt).toContain("Current recovery prompt:");
    expect(packet.prompt).toContain(`current HEAD ${currentHead}`);
    expect(packet.prompt).toContain("wiki checkpoint demo --repo");
    expect(packet.prompt).toContain("wiki forge next demo --repo");
  });
});
