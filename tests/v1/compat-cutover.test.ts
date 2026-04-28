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
  ["wiki forge next", "wiki v1 forge next"],
  ["wiki forge status", "wiki v1 forge status"],
  ["wiki forge start", "wiki v1 forge start"],
  ["wiki forge release", "wiki v1 forge release"],
  ["wiki forge evidence", "wiki v1 forge evidence"],
  ["wiki forge review record", "wiki v1 forge review record"],
  ["wiki forge check", "wiki v1 forge check"],
  ["wiki forge close", "wiki v1 forge close"],
  ["wiki forge run", "wiki v1 forge run"],
] as const;

describe("v1 compatibility cutover", () => {
  test("compatibility report marks implemented lifecycle commands as V1-owned", () => {
    expect(getLegacyCompatibilityReport()).toEqual([
      ...v1OwnedCommands.map(([command, replacement]) => ({
        command,
        status: "v1-owned" as const,
        replacement,
        reason: "V1-owned command; no legacy fallback",
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
      replacement: "wiki v1 forge run",
      reason: "V1-owned command; no legacy fallback",
    });
    expect(describeLegacyCommand("wiki research file")).toEqual({
      command: "wiki research file",
      status: "legacy-only",
      replacement: null,
      reason: "no V1 lifecycle replacement declared",
    });
  });

  test("import preserves source files and writes only to explicit V1 target paths", () => {
    const plan = planProjectImport({
      project: "wiki-forge",
      targetRoot: "projects/wiki-forge/v1",
      documents: [validSlice],
    });

    expect(plan).toEqual({
      status: "planned",
      preserveSourceFiles: true,
      writes: [
        {
          sourcePath: "projects/wiki-forge/specs/slices/WIKI-FORGE-220/index.md",
          targetPath: "projects/wiki-forge/v1/slices/WIKI-FORGE-220.json",
          recordKind: "slice",
        },
      ],
    });
  });
});
