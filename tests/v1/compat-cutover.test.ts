import { describe, expect, test } from "bun:test";
import { describeLegacyCommand, getLegacyCompatibilityReport } from "../../src/v1/cli/legacy-compat";
import { planProjectImport } from "../../src/v1/migration/import-project";
import { parseVaultDocument } from "../../src/v1/vault/frontmatter-codec";

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

const v1OwnedCommands = [
  ["wiki forge next", "wiki forge next"],
  ["wiki forge status", "wiki forge status"],
  ["wiki forge plan", "wiki forge plan"],
  ["wiki forge start", "wiki forge start"],
  ["wiki forge release", "wiki forge release"],
  ["wiki forge evidence", "wiki forge evidence"],
  ["wiki forge review record", "wiki forge review record"],
  ["wiki forge check", "wiki forge check"],
  ["wiki forge amend", "wiki forge amend"],
  ["wiki forge close", "wiki forge close"],
  ["wiki forge run", "wiki forge run"],
] as const;

describe("v1 compatibility cutover", () => {
  test("compatibility report marks implemented lifecycle commands as V1-owned", () => {
    expect(getLegacyCompatibilityReport()).toEqual([
      ...v1OwnedCommands.map(([command, replacement]) => ({
        command,
        status: "v1-owned" as const,
        replacement,
        reason: "Forge-owned command; no legacy fallback",
      })),
      {
        command: "wiki maintain",
        status: "legacy-admin",
        replacement: "wiki legacy maintain",
        reason: "maintenance mutates legacy projections and remains outside V1 lifecycle truth",
      },
    ]);
  });

  test("single command lookup names replacement or legacy-only status", () => {
    expect(describeLegacyCommand("wiki forge run")).toEqual({
      command: "wiki forge run",
      status: "v1-owned",
      replacement: "wiki forge run",
      reason: "Forge-owned command; no legacy fallback",
    });
    expect(describeLegacyCommand("wiki research file")).toEqual({
      command: "wiki research file",
      status: "legacy-only",
      replacement: null,
      reason: "no V1 lifecycle replacement declared",
    });
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
