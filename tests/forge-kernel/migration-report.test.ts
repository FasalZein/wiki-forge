import { describe, expect, test } from "bun:test";
import { buildMigrationReport } from "../../src/forge/migration/report";
import { planProjectImport } from "../../src/forge/migration/import-project";
import { classifyLegacyDocument } from "../../src/forge/vault/legacy-classifier";
import { parseVaultDocument } from "../../src/forge/vault/frontmatter-codec";

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
const repairableSlice = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-221/index.md", `---
title: WIKI-FORGE-221
type: spec
spec_kind: task-hub
project: wiki-forge
status: ready
---
# repairable
`);
const quarantinedNote = parseVaultDocument("projects/wiki-forge/notes/random.md", `---
title: random
project: wiki-forge
---
# random
`);

describe("forge migration report", () => {
  test("migration dry-run quarantines old specs records under the no-fallback Forge model", () => {
    const report = buildMigrationReport({
      project: "wiki-forge",
      documents: [validSlice, repairableSlice, quarantinedNote],
    });

    expect(report.summary).toEqual({ valid: 0, repairable: 0, quarantined: 3, projection: 0 });
    expect(report.issues).toEqual([
      {
        path: "projects/wiki-forge/specs/slices/WIKI-FORGE-220/index.md",
        status: "quarantined",
        diagnostics: ["UnknownLifecycleShape: document has project metadata but no recognized canonical record kind"],
      },
      {
        path: "projects/wiki-forge/specs/slices/WIKI-FORGE-221/index.md",
        status: "quarantined",
        diagnostics: ["UnknownLifecycleShape: document has project metadata but no recognized canonical record kind"],
      },
      {
        path: "projects/wiki-forge/notes/random.md",
        status: "quarantined",
        diagnostics: ["UnknownLifecycleShape: document has project metadata but no recognized canonical record kind"],
      },
    ]);
    expect(report.writes).toEqual([]);
  });

  test("quarantined records cannot participate in lifecycle reads", () => {
    const importPlan = planProjectImport({
      project: "wiki-forge",
      targetRoot: "projects/wiki-forge/forge",
      documents: [validSlice, quarantinedNote],
    });

    expect(importPlan).toEqual({
      status: "refused",
      reason: "quarantined lifecycle records cannot participate in Forge import",
      quarantinedPaths: ["projects/wiki-forge/specs/slices/WIKI-FORGE-220/index.md", "projects/wiki-forge/notes/random.md"],
      preserveSourceFiles: true,
      writes: [],
    });
  });

  test("old specs documents classify as quarantined under Forge", () => {
    const classification = classifyLegacyDocument(validSlice);
    const report = buildMigrationReport({ project: "wiki-forge", documents: [validSlice] });

    expect(classification.status).toBe("quarantined");
    expect(report.writes).toEqual([]);
    expect(report.preserveSourceFiles).toBe(true);
  });
});
