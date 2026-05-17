import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

describe("wiki ask --json", () => {
  test("returns structured answer and sources JSON", () => {
    const vault = tempDir("wiki-ask-json-vault");
    initVault(vault);
    mkdirSync(join(vault, "projects", "demo"), { recursive: true });
    writeFileSync(join(vault, "projects", "demo", "_summary.md"), "# Demo\n\nThe project uses a single Forge Plan loop.\n", "utf8");

    const result = runWiki(["ask", "demo", "where is the plan loop", "--bm25", "--json"], { KNOWLEDGE_VAULT_ROOT: vault });

    expect(result.exitCode).toBe(0);
    const payload = result.json();
    expect(payload).toMatchObject({
      project: "demo",
      question: "where is the plan loop",
      retrievalMode: "bm25",
    });
    expect(typeof payload.answer).toBe("string");
    expect(Array.isArray(payload.sources)).toBe(true);
    expect(payload.sources[0]).toMatchObject({
      scope: "project",
    });
  });
});
