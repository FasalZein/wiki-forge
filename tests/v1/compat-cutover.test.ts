import { describe, expect, test } from "bun:test";
import { planProjectImport } from "../../src/v1/migration/import-project";
import { parseVaultDocument } from "../../src/v1/vault/frontmatter-codec";
import { WIKI_COMMANDS, resolveWikiCommand } from "../../src/wiki";

const validSlice = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-220/index.md", `---
title: WIKI-FORGE-220
type: spec
spec_kind: task-hub
project: wiki-forge
task_id: WIKI-FORGE-220
status: ready
---
# valid
`);

describe("compatibility cutover", () => {
  test("public v1 compatibility command namespace is removed", () => {
    expect(resolveWikiCommand(["v1", "compat", "wiki", "forge", "next"])).toEqual({
      command: "v1",
      args: ["compat", "wiki", "forge", "next"],
    });
    expect(WIKI_COMMANDS["v1:compat"]).toBeUndefined();
    expect(WIKI_COMMANDS["v1:forge:next"]).toBeUndefined();
  });

  test("stable commands remain the public surface", () => {
    expect(WIKI_COMMANDS.next).toBeDefined();
    expect(WIKI_COMMANDS.resume).toBeDefined();
    expect(WIKI_COMMANDS.handover).toBeDefined();
  });

  test("legacy specs documents are refused instead of imported by runtime compatibility", () => {
    const plan = planProjectImport({
      project: "wiki-forge",
      targetRoot: "projects/wiki-forge/v1",
      documents: [validSlice],
    });

    expect(plan).toEqual({
      status: "refused",
      preserveSourceFiles: true,
      quarantinedPaths: ["projects/wiki-forge/specs/slices/WIKI-FORGE-220/index.md"],
      reason: "quarantined lifecycle records cannot participate in V1 import",
      writes: [],
    });
  });
});
