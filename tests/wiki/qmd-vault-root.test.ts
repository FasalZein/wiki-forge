import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

describe("QMD active vault routing", () => {
  test("qmd-status binds the knowledge collection to the active KNOWLEDGE_VAULT_ROOT", () => {
    const firstVault = tempDir("wiki-qmd-first-vault");
    const secondVault = tempDir("wiki-qmd-second-vault");
    initVault(firstVault);
    initVault(secondVault);

    const first = runWiki(["qmd-status"], { KNOWLEDGE_VAULT_ROOT: firstVault });
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toContain(`knowledge (${firstVault})`);

    const second = runWiki(["qmd-status"], { KNOWLEDGE_VAULT_ROOT: secondVault });
    expect(second.exitCode).toBe(0);
    const output = second.stdout.toString();
    expect(output).toContain(`knowledge (${secondVault})`);
    expect(output).not.toContain(`knowledge (${firstVault})`);
  });

  test("query results do not leak documents from a previous active vault", () => {
    const firstVault = tempDir("wiki-qmd-query-first-vault");
    const secondVault = tempDir("wiki-qmd-query-second-vault");
    initVault(firstVault);
    initVault(secondVault);
    mkdirSync(join(firstVault, "projects", "alpha"), { recursive: true });
    writeFileSync(join(firstVault, "projects", "alpha", "unique.md"), "# Alpha\n\nneedle-alpha-qmd-isolation lives only here.\n", "utf8");
    mkdirSync(join(secondVault, "projects", "beta"), { recursive: true });
    writeFileSync(join(secondVault, "projects", "beta", "other.md"), "# Beta\n\nNo alpha isolation token.\n", "utf8");

    const first = runWiki(["query", "--bm25", "needle-alpha-qmd-isolation"], { KNOWLEDGE_VAULT_ROOT: firstVault });
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toContain("projects/alpha/unique.md");

    const second = runWiki(["query", "--bm25", "needle-alpha-qmd-isolation"], { KNOWLEDGE_VAULT_ROOT: secondVault });
    expect(second.exitCode).toBe(0);
    expect(second.stdout.toString()).not.toContain("projects/alpha/unique.md");
  });
});
