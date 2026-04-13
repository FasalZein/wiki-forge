import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki research audit", () => {
  test("flags dead links and missing influence", async () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/gone") return new Response("missing", { status: 404 });
        return new Response("ok");
      },
    });

    try {
      expect(runWiki(["research", "scaffold", "demo-topic"], env).exitCode).toBe(0);
      const pagePath = join(vault, "research", "demo-topic", "dead-link.md");
      writeFileSync(pagePath, `---\ntitle: Dead Link\ntype: research\ntopic: demo-topic\nstatus: draft\nsource_type: article\nsources:\n  - url: http://127.0.0.1:${server.port}/gone\n    accessed: 2026-04-13\n    claim: Broken source\ninfluenced_by: []\nupdated: 2026-04-13\nverification_level: unverified\n---\n# Dead Link\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

      const result = runWiki(["research", "audit", "demo-topic", "--json"], env);
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout.toString());
      expect(json.counts.deadLinks).toBe(1);
      expect(json.counts.missingInfluence).toBe(1);
      expect(json.deadLinks[0].url).toContain("/gone");
    } finally {
      server.stop(true);
    }
  });

  test("passes when links are live and influenced_by points at a real page", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["research", "scaffold", "demo-topic"], env).exitCode).toBe(0);
    const decisionsPath = join(vault, "projects", "demo", "decisions.md");
    writeFileSync(decisionsPath, `${readFileSync(decisionsPath, "utf8").trimEnd()}\n- [[research/demo-topic/linked]]\n`, "utf8");
    const pagePath = join(vault, "research", "demo-topic", "linked.md");
    writeFileSync(pagePath, `---\ntitle: Linked Research\ntype: research\ntopic: demo-topic\nstatus: applied\nsource_type: article\nsources:\n  - url: https://example.com\n    accessed: 2026-04-13\n    claim: Live source\ninfluenced_by:\n  - projects/demo/decisions\nupdated: 2026-04-13\nverification_level: source-checked\n---\n# Linked Research\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

    const result = runWiki(["research", "audit", "demo-topic", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.counts.deadLinks).toBe(0);
    expect(json.counts.missingInfluence).toBe(0);
    expect(json.counts.invalidInfluence).toBe(0);
  });

  test("research ingest scaffolds influenced_by frontmatter", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const sourcePath = join(vault, "notes.txt");
    writeFileSync(sourcePath, "hello", "utf8");

    expect(runWiki(["research", "ingest", "demo-topic", sourcePath], env).exitCode).toBe(0);
    const pagePath = join(vault, "research", "demo-topic", "notes.md");
    expect(readFileSync(pagePath, "utf8")).toContain("influenced_by: []");
  });
});
