import { afterEach, describe, expect, test } from "bun:test";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki subprocess helper", () => {
  test("supports vault shorthand and exposes json()", () => {
    const vault = tempDir("wiki-helper-vault");
    initVault(vault);

    expect(runWiki(["scaffold-project", "helperproj"], { vault }).exitCode).toBe(0);
    const backlog = runWiki(["backlog", "helperproj", "--json"], { vault });

    expect(backlog.exitCode).toBe(0);
    expect(backlog.json<{ project: string }>().project).toBe("helperproj");
  });

  test("still accepts the legacy env-map signature", () => {
    const vault = tempDir("wiki-helper-legacy-vault");
    initVault(vault);

    const result = runWiki(["scaffold-project", "legacyproj"], { KNOWLEDGE_VAULT_ROOT: vault });

    expect(result.exitCode).toBe(0);
  });
});
