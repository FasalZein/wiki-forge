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

describe("v1 compatibility cutover", () => {
  test("compatibility report maps old commands to V1 or legacy admin status", () => {
    expect(getLegacyCompatibilityReport()).toEqual([
      {
        command: "wiki forge next",
        status: "v1-compatible",
        replacement: "wiki v1 forge next",
        reason: "same read-only lifecycle projection semantics",
      },
      {
        command: "wiki forge status",
        status: "v1-compatible",
        replacement: "wiki v1 forge status",
        reason: "same read-only lifecycle projection semantics",
      },
      {
        command: "wiki maintain",
        status: "legacy-admin",
        replacement: "wiki legacy maintain",
        reason: "maintenance mutates legacy projections and remains outside V1 lifecycle truth",
      },
    ]);
  });

  test("single command lookup names replacement or legacy-only status", () => {
    expect(describeLegacyCommand("wiki forge next")).toEqual({
      command: "wiki forge next",
      status: "v1-compatible",
      replacement: "wiki v1 forge next",
      reason: "same read-only lifecycle projection semantics",
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
