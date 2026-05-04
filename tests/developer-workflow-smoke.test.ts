import { describe, expect, test } from "bun:test";
import { resolveAskRetrievalModeWithFreshness, KNOWLEDGE_CONTEXTS } from "../src/wiki/retrieval/qmd-freshness";
import { parseSyncArgs, buildSyncPlan } from "../scripts/sync-local";

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
