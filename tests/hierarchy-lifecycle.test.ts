import { afterEach, describe, expect, test } from "bun:test";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("legacy feature/PRD lifecycle commands", () => {
  test.each(["start-feature", "close-feature", "start-prd", "close-prd"])("%s is quarantined in favor of Forge planning", (command) => {
    const vault = tempDir(`legacy-${command}`);
    initVault(vault);

    const result = runWiki([command, "proj", command.includes("feature") ? "FEAT-001" : "PRD-001"], {
      KNOWLEDGE_VAULT_ROOT: vault,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("legacy workflow command is quarantined");
    expect(result.stderr.toString()).toContain("wiki forge plan");
  });
});
