import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("research pipeline surface", () => {
  test("status reports ready-to-distill research explicitly", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["research", "scaffold", "demo-topic"], env).exitCode).toBe(0);
    const pagePath = join(vault, "research", "demo-topic", "verified-note.md");
    writeFileSync(pagePath, `---\ntitle: Verified Note\ntype: research\ntopic: demo-topic\nstatus: verified\nsource_type: article\nsources:\n  - url: https://example.com\n    accessed: 2026-04-20\n    claim: Verified claim\ninfluenced_by: []\nupdated: 2026-04-20\nverification_level: source-checked\n---\n# Verified Note\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

    const result = runWiki(["research", "status", "demo-topic", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.counts.readyToDistill).toBe(1);
    expect(json.counts.missingInfluence).toBe(1);
    expect(json.workflow.byStage.distill).toBe(1);
  });

  test("status surfaces canonical project-truth targets for project-bound research", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["research", "scaffold", "demo-topic"], env).exitCode).toBe(0);
    const pagePath = join(vault, "research", "demo-topic", "verified-note.md");
    writeFileSync(pagePath, `---\ntitle: Verified Note\ntype: research\ntopic: demo-topic\nproject: demo\nstatus: verified\nsource_type: article\nsources:\n  - url: https://example.com\n    accessed: 2026-04-20\n    claim: Verified claim\ninfluenced_by: []\nupdated: 2026-04-20\nverification_level: source-checked\n---\n# Verified Note\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

    const result = runWiki(["research", "status", "demo-topic", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.workflow.canonicalTargets).toEqual([
      "projects/demo/architecture/domain-language",
      "projects/demo/decisions",
    ]);
  });

  test("distill records the project-truth target and promotes verified research to applied", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["research", "scaffold", "demo-topic"], env).exitCode).toBe(0);
    const pagePath = join(vault, "research", "demo-topic", "verified-note.md");
    writeFileSync(pagePath, `---\ntitle: Verified Note\ntype: research\ntopic: demo-topic\nproject: demo\nstatus: verified\nsource_type: article\nsources:\n  - url: https://example.com\n    accessed: 2026-04-20\n    claim: Verified claim\ninfluenced_by: []\nupdated: 2026-04-20\nverification_level: source-checked\n---\n# Verified Note\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

    const result = runWiki(["research", "distill", "research/demo-topic/verified-note", "projects/demo/decisions", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.applied).toBe(true);
    expect(json.status).toBe("applied");
    expect(json.target).toBe("projects/demo/decisions");
    const content = readFileSync(pagePath, "utf8");
    expect(content).toContain("status: applied");
    expect(content).toContain("projects/demo/decisions");
  });

  test("distill records the handoff target without overstating unverified research", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["research", "scaffold", "demo-topic"], env).exitCode).toBe(0);
    const pagePath = join(vault, "research", "demo-topic", "draft-note.md");
    writeFileSync(pagePath, `---\ntitle: Draft Note\ntype: research\ntopic: demo-topic\nproject: demo\nstatus: reviewed\nsource_type: article\nsources:\n  - url: https://example.com\n    accessed: 2026-04-20\n    claim: Early claim\ninfluenced_by: []\nupdated: 2026-04-20\nverification_level: unverified\n---\n# Draft Note\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

    const result = runWiki(["research", "distill", "research/demo-topic/draft-note", "projects/demo/architecture/domain-language", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.applied).toBe(false);
    expect(json.status).toBe("reviewed");
    const content = readFileSync(pagePath, "utf8");
    expect(content).toContain("status: reviewed");
    expect(content).toContain("projects/demo/architecture/domain-language");
  });
});
