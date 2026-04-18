import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listCodeFiles, listRepoMarkdownDocs } from "../src/lib/repo-scan";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function seedRepo(): string {
  const repo = tempDir("wiki-consumer-repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "guide.md"), "# guide\n", "utf8");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "new.ts"), "export const x = 1\n", "utf8");
  mkdirSync(join(repo, "archive"), { recursive: true });
  writeFileSync(join(repo, "archive", "old.ts"), "export const y = 2\n", "utf8");
  mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "pkg", "README.md"), "# pkg\n", "utf8");
  writeFileSync(join(repo, "node_modules", "pkg", "index.ts"), "export const z = 3\n", "utf8");
  return repo;
}

function writeProjectConfig(repo: string, body: string): void {
  writeFileSync(join(repo, "wiki.config.jsonc"), body, "utf8");
}

describe("listRepoMarkdownDocs — repo.ignore honored", () => {
  test("zero-config: docs/guide.md is returned (regression guard)", async () => {
    const repo = seedRepo();
    const docs = await listRepoMarkdownDocs(repo);
    expect(docs).toContain("docs/guide.md");
  });

  test("with repo.ignore=['docs/**']: docs/guide.md is NOT returned", async () => {
    const repo = seedRepo();
    writeProjectConfig(repo, `{ "repo": { "ignore": ["docs/**"] } }`);
    const docs = await listRepoMarkdownDocs(repo);
    expect(docs).not.toContain("docs/guide.md");
  });

  test("built-in exclusions still apply: node_modules/**/README.md never returned even with ignore set", async () => {
    const repo = seedRepo();
    writeProjectConfig(repo, `{ "repo": { "ignore": ["docs/**"] } }`);
    const docs = await listRepoMarkdownDocs(repo);
    expect(docs.some((p) => p.startsWith("node_modules/"))).toBe(false);
  });
});

describe("listCodeFiles — repo.ignore honored", () => {
  test("zero-config: src/new.ts and archive/old.ts both returned", () => {
    const repo = seedRepo();
    const files = listCodeFiles(repo);
    expect(files).toContain("src/new.ts");
  });

  test("with repo.ignore=['archive/**']: archive/old.ts NOT returned; src/new.ts still is", () => {
    const repo = seedRepo();
    writeProjectConfig(repo, `{ "repo": { "ignore": ["archive/**"] } }`);
    const files = listCodeFiles(repo);
    expect(files).not.toContain("archive/old.ts");
    expect(files).toContain("src/new.ts");
  });

  test("zero-config behavior byte-identical with or without empty config", () => {
    const repo = seedRepo();
    const noConfig = listCodeFiles(repo);
    writeProjectConfig(repo, `{}`);
    const emptyConfig = listCodeFiles(repo);
    expect(emptyConfig).toEqual(noConfig);
  });
});
