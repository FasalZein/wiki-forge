import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyResearchPath, describeAllowedResearchPaths } from "../src/lib/research";
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
      expect(runWiki(["research", "scaffold", "demo-topic", "--global"], env).exitCode).toBe(0);
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

  test("skips public live link checks by default while preserving influence validation", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["research", "scaffold", "demo-topic", "--global"], env).exitCode).toBe(0);
    const decisionsPath = join(vault, "projects", "demo", "decisions.md");
    writeFileSync(decisionsPath, `${readFileSync(decisionsPath, "utf8").trimEnd()}\n- [[research/demo-topic/linked]]\n`, "utf8");
    const pagePath = join(vault, "research", "demo-topic", "linked.md");
    writeFileSync(pagePath, `---\ntitle: Linked Research\ntype: research\ntopic: demo-topic\nstatus: applied\nsource_type: article\nsources:\n  - url: https://example.invalid/unreachable\n    accessed: 2026-04-13\n    claim: Public source checked only in live mode\ninfluenced_by:\n  - projects/demo/decisions\nupdated: 2026-04-13\nverification_level: source-checked\n---\n# Linked Research\n\n## Key Findings\n\n- source: [1]\n`, "utf8");

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

    expect(runWiki(["research", "ingest", "demo-topic", "--global", sourcePath], env).exitCode).toBe(0);
    const pagePath = join(vault, "research", "demo-topic", "notes.md");
    expect(readFileSync(pagePath, "utf8")).toContain("influenced_by: []");
  });

  test("research path rules hard-cut project research into project folders", () => {
    expect(classifyResearchPath("projects/demo/research/auth-options/session-auth-options.md")).toBe("research-page");
    expect(classifyResearchPath("projects/demo/research/auth-options/_overview.md")).toBe("topic-overview");
    expect(classifyResearchPath("research/auth-options/session-auth-options.md")).toBe("research-page");
    expect(classifyResearchPath("research/projects/demo/session-auth-options.md")).toBeNull();
    expect(describeAllowedResearchPaths()).not.toContain("legacy");
    expect(describeAllowedResearchPaths()).toContain("projects/<project>/research/<topic>");
  });

  test("research lint reports misplaced project research outside project roots without moving it", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    mkdirSync(join(vault, "research", "projects", "demo"), { recursive: true });
    writeFileSync(join(vault, "research", "projects", "demo", "old-note.md"), `---\ntitle: Old Note\ntype: research\nproject: demo\n---\n# Old Note\n`, "utf8");

    const result = runWiki(["research", "lint", "--project", "demo", "--json"], env);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.misplacedProjectResearch).toEqual([
      {
        path: "research/projects/demo/old-note.md",
        project: "demo",
        expectedRoot: "projects/demo/research",
        reason: "legacy project research layout; use projects/<project>/research/<topic>/<slug>.md",
      },
    ]);
    expect(readFileSync(join(vault, "research", "projects", "demo", "old-note.md"), "utf8")).toContain("# Old Note");
  });

  test("project research ingest writes inside the project research folder", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const sourcePath = join(vault, "project-source.txt");
    writeFileSync(sourcePath, "project source", "utf8");

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const result = runWiki(["research", "ingest", "auth-options", "--project", "demo", sourcePath], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("created projects/demo/research/auth-options/project-source.md");
    const projectResearchPath = join(vault, "projects", "demo", "research", "auth-options", "project-source.md");
    expect(readFileSync(projectResearchPath, "utf8")).toContain("project: demo");
    expect(() => readFileSync(join(vault, "research", "auth-options", "project-source.md"), "utf8")).toThrow();
  });

  test("global research refuses topics that match an existing project without --global", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const sourcePath = join(vault, "project-source.txt");
    writeFileSync(sourcePath, "project source", "utf8");

    expect(runWiki(["scaffold-project", "wiki-forge"], env).exitCode).toBe(0);
    const result = runWiki(["research", "ingest", "wiki-forge", sourcePath], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("research ingest needs --project <project>");
  });

  test("source ingest requires explicit project or global routing", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const sourcePath = join(vault, "source-ingest.txt");
    writeFileSync(sourcePath, "source ingest", "utf8");

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["source", "ingest", "--topic", "auth-options", sourcePath], env).exitCode).toBe(1);
    const result = runWiki(["source", "ingest", "--project", "demo", "--topic", "auth-options", sourcePath], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("created projects/demo/research/auth-options/source-ingest.md");
    expect(readFileSync(join(vault, "projects", "demo", "research", "auth-options", "source-ingest.md"), "utf8")).toContain("project: demo");
  });

  test("migrates legacy research/projects notes into project research", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    mkdirSync(join(vault, "research", "projects", "demo", "auth-options"), { recursive: true });
    writeFileSync(join(vault, "research", "projects", "demo", "auth-options", "old-note.md"), `---\ntitle: Old Note\ntype: research\ntopic: legacy\n---\n# Old Note\n`, "utf8");

    const dryRun = runWiki(["research", "migrate-projects", "--project", "demo", "--json"], env);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.json().counts.ready).toBe(1);
    expect(dryRun.json().migrations[0].to).toBe("projects/demo/research/auth-options/old-note.md");

    const write = runWiki(["research", "migrate-projects", "--project", "demo", "--write", "--json"], env);
    expect(write.exitCode).toBe(0);
    expect(write.json().counts.migrated).toBe(1);
    expect(write.json().removedEmptyDirs).toContain("research/projects/demo/auth-options");
    expect(write.json().removedEmptyDirs).toContain("research/projects/demo");
    const migrated = readFileSync(join(vault, "projects", "demo", "research", "auth-options", "old-note.md"), "utf8");
    expect(migrated).toContain("project: demo");
    expect(migrated).toContain("topic: auth-options");
    expect(() => readFileSync(join(vault, "research", "projects", "demo", "auth-options", "old-note.md"), "utf8")).toThrow();
  });

  test("project research files inside the project research folder", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const result = runWiki(["research", "file", "auth-options", "--project", "demo", "Session Auth Options"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("created projects/demo/research/auth-options/session-auth-options.md");
    const projectResearchPath = join(vault, "projects", "demo", "research", "auth-options", "session-auth-options.md");
    expect(readFileSync(projectResearchPath, "utf8")).toContain("project: demo");
    expect(() => readFileSync(join(vault, "research", "demo", "session-auth-options.md"), "utf8")).toThrow();
    expect(() => readFileSync(join(vault, "research", "projects", "demo", "session-auth-options.md"), "utf8")).toThrow();

    const status = runWiki(["research", "status", "auth-options", "--project", "demo", "--json"], env);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout.toString()).root).toBe("projects/demo/research/auth-options");

    const lint = runWiki(["research", "lint", "auth-options", "--project", "demo", "--json"], env);
    expect(lint.exitCode).toBe(1);
    expect(JSON.parse(lint.stdout.toString()).root).toBe("projects/demo/research/auth-options");
  });
});
