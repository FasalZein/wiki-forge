import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupVault() {
  const vault = tempDir("wiki-vault-layers");
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
  return vault;
}

describe("scaffold-layer", () => {
  test("creates books layer index file", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["scaffold-layer", "books"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(vault, "books", "index.md"))).toBe(true);
    const content = readFileSync(join(vault, "books", "index.md"), "utf8");
    expect(content).toContain("type: layer-index");
    expect(content).toContain("layer: books");
  });

  test("is idempotent — does not overwrite existing layer index", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    runWiki(["scaffold-layer", "books"], env);
    writeFileSync(join(vault, "books", "index.md"), "# My Custom Index\n", "utf8");

    const result = runWiki(["scaffold-layer", "books"], env);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(vault, "books", "index.md"), "utf8")).toBe("# My Custom Index\n");
  });

  test("rejects unknown layer name", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["scaffold-layer", "nonexistent-layer"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown layer");
  });
});

describe("create-layer-page", () => {
  test("creates a new page in the books layer", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    runWiki(["scaffold-layer", "books"], env);
    const result = runWiki(["create-layer-page", "books", "The Pragmatic Programmer"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(vault, "books", "the-pragmatic-programmer.md"))).toBe(true);
    const content = readFileSync(join(vault, "books", "the-pragmatic-programmer.md"), "utf8");
    expect(content).toContain("type: layer-page");
    expect(content).toContain("layer: books");
    expect(content).toContain("The Pragmatic Programmer");
  });

  test("fails if layer page already exists", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    runWiki(["scaffold-layer", "books"], env);
    runWiki(["create-layer-page", "books", "Duplicate Book"], env);
    const result = runWiki(["create-layer-page", "books", "Duplicate Book"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("layer page already exists");
  });

  test("rejects unknown layer", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["create-layer-page", "unknown-layer", "Some Title"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown layer");
  });
});
