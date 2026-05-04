import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAskRetrievalModeWithFreshness, KNOWLEDGE_CONTEXTS } from "../src/wiki/retrieval/qmd-freshness";
import { parseSyncArgs, buildSyncPlan } from "../scripts/sync-local";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("developer-ready wiki-only workflow smoke", () => {
  test("wiki-only install syncs the wiki skill and QMD setup without Forge workflow skills", () => {
    const options = parseSyncArgs(["--wiki-only"], process.cwd());
    const plan = buildSyncPlan(options);
    const labels = plan.map((step) => step.label);

    expect(options.installSet).toBe("wiki-only");
    expect(labels).toContain("link wiki cli");
    expect(labels).toContain("install latest qmd");
    expect(labels).toContain("rebuild qmd native modules");
    expect(labels).toContain("install repo skill wiki");
    expect(labels.some((label) => label.includes("install repo skill forge"))).toBe(false);
    expect(labels.some((label) => label.includes("companion skill"))).toBe(false);
  });

  test("full install includes Forge workflow skills for opt-in lifecycle use", () => {
    const options = parseSyncArgs(["--full"], process.cwd());
    const labels = buildSyncPlan(options).map((step) => step.label);

    expect(options.installSet).toBe("full");
    expect(labels).toContain("install repo skill wiki");
    expect(labels).toContain("install repo skill forge");
    expect(labels.some((label) => label.includes("companion skill desloppify"))).toBe(true);
  });

  test("Forge next-command guidance lets agents follow lifecycle without guessing", () => {
    const vault = createVaultWithDraftSlice();

    const nextDraft = runWiki(["forge", "next", "demo", "--json"], { vault });
    expect(nextDraft.exitCode).toBe(0);
    expect(nextDraft.json()).toMatchObject({
      nextAction: "release-draft-slice",
      nextCommand: "wiki forge release demo DEMO-001",
    });

    const release = runWiki(["forge", "release", "demo", "DEMO-001", "--json"], { vault });
    expect(release.exitCode).toBe(0);

    const nextReady = runWiki(["forge", "next", "demo", "--json"], { vault });
    expect(nextReady.exitCode).toBe(0);
    expect(nextReady.json()).toMatchObject({
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start demo DEMO-001",
    });
  });

  test("QMD contexts and retrieval freshness model support second-brain storage and retrieval", () => {
    expect(KNOWLEDGE_CONTEXTS).toEqual([
      { path: "/", text: "Knowledge vault: projects, wiki, research" },
      { path: "/projects", text: "Project-specific maintained docs under projects/<name>. Prefer these for repo questions." },
      { path: "/research", text: "Research notes and evidence. Prefer when the question asks why, compares options, or needs supporting sources." },
      { path: "/wiki", text: "Cross-project concepts, entities, and syntheses. Use for shared patterns, not project-specific implementation unless no project docs exist." },
    ]);

    expect(resolveAskRetrievalModeWithFreshness("why did we choose qmd", {
      sdkHybridAvailable: true,
      status: { hasVectorIndex: true, needsEmbedding: 0 },
    })).toBe("sdk-hybrid");

    expect(resolveAskRetrievalModeWithFreshness("why did we choose qmd", {
      sdkHybridAvailable: true,
      status: { hasVectorIndex: true, needsEmbedding: 3 },
    })).toBe("bm25");
  });
});

function createVaultWithDraftSlice() {
  const vault = tempDir("developer-workflow-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---
title: DEMO-001 smoke slice
type: forge-slice
project: demo
task_id: DEMO-001
status: draft
---
# DEMO-001
`, "utf8");
  return vault;
}
