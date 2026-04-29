import { describe, expect, test } from "bun:test";
import { decodeForgeRecord } from "../../src/forge/vault/records";
import {
  forgeEvidencePath,
  forgeFeaturePath,
  forgeHandoverPath,
  forgePlanningSessionPath,
  forgePrdPath,
  forgeSliceDir,
  forgeSlicePath,
  forgeSlicePlanPath,
  forgeSliceTestPlanPath,
  isForgePath,
} from "../../src/forge/vault/forge-paths";
import { parseVaultDocument } from "../../src/forge/vault/frontmatter-codec";
import { renderForgeHandoverMarkdown } from "../../src/wiki/memory/handover/render";
import type { ForgeHandoverRecord } from "../../src/wiki/memory/handover/schema";

describe("forge no-fallback paths", () => {
  test("builds only projects/<project>/forge/** paths", () => {
    expect(forgeFeaturePath("wiki-forge", "FEAT-001", "dogfood")).toBe("projects/wiki-forge/forge/features/FEAT-001-dogfood.md");
    expect(forgePrdPath("wiki-forge", "PRD-001", "first-layer")).toBe("projects/wiki-forge/forge/prds/PRD-001-first-layer.md");
    expect(forgeSliceDir("wiki-forge", "WIKI-FORGE-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-001");
    expect(forgeSlicePath("wiki-forge", "WIKI-FORGE-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-001/index.md");
    expect(forgeSlicePlanPath("wiki-forge", "WIKI-FORGE-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-001/plan.md");
    expect(forgeSliceTestPlanPath("wiki-forge", "WIKI-FORGE-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-001/test-plan.md");
    expect(forgeEvidencePath("wiki-forge", "WIKI-FORGE-001")).toBe("projects/wiki-forge/forge/evidence/WIKI-FORGE-001.md");
    expect(forgePlanningSessionPath("wiki-forge", "2026-dogfood")).toBe("projects/wiki-forge/forge/sessions/2026-dogfood.md");
    expect(forgeHandoverPath("wiki-forge", "2026-handover")).toBe("projects/wiki-forge/forge/handovers/2026-handover.md");
  });

  test("identifies specs paths as outside Forge instead of fallback", () => {
    expect(isForgePath("projects/wiki-forge/forge/slices/WIKI-FORGE-001/index.md")).toBe(true);
    expect(isForgePath("projects/wiki-forge/specs/slices/WIKI-FORGE-001/index.md")).toBe(false);
  });
});

describe("forge records", () => {
  test("decodes feature, PRD, slice, evidence, and handover records", () => {
    const records = [
      parseVaultDocument("projects/wiki-forge/forge/features/FEAT-001-dogfood.md", `---\ntitle: Dogfood\nproject: wiki-forge\ntype: forge-feature\nfeature_id: FEAT-001\nstatus: draft\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nprd_ids:\n  - PRD-001\n---\n# Dogfood\n`),
      parseVaultDocument("projects/wiki-forge/forge/prds/PRD-001-first-layer.md", `---\ntitle: First layer\nproject: wiki-forge\ntype: forge-prd\nprd_id: PRD-001\nparent_feature: FEAT-001\nstatus: draft\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nslice_ids:\n  - WIKI-FORGE-001\n---\n# First layer\n`),
      parseVaultDocument("projects/wiki-forge/forge/slices/WIKI-FORGE-001/index.md", `---\ntitle: Slice\nproject: wiki-forge\ntype: forge-slice\ntask_id: WIKI-FORGE-001\nparent_feature: FEAT-001\nparent_prd: PRD-001\nstatus: in-progress\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nsource_paths:\n  - src/forge/vault/records.ts\n---\n# Slice\n`),
      parseVaultDocument("projects/wiki-forge/forge/evidence/WIKI-FORGE-001.md", `---\ntitle: Evidence\nproject: wiki-forge\ntype: forge-evidence\ntask_id: WIKI-FORGE-001\nstatus: draft\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nrecords:\n  - kind: tdd\n    result: passed\n---\n# Evidence\n`),
      parseVaultDocument("projects/wiki-forge/forge/handovers/2026-handover.md", `---\ntitle: Handover\nproject: wiki-forge\ntype: forge-handover\nsession_id: 2026-handover\ncreated_at: '2026-04-28T00:00:00.000Z'\nagent: pi\nrelated_features:\n  - FEAT-001\nrelated_prds:\n  - PRD-001\nrelated_slices:\n  - WIKI-FORGE-001\nnext_action: Continue Forge\n---\n# Handover\n`),
    ].map(decodeForgeRecord);

    expect(records.map((record) => record.status)).toEqual(["valid", "valid", "valid", "valid", "valid"]);
    expect(records.map((record) => record.status === "valid" ? record.record.kind : null)).toEqual(["feature", "prd", "slice", "evidence", "handover"]);
  });

  test("quarantines old specs slice paths instead of decoding them", () => {
    const decoded = decodeForgeRecord(parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-001/index.md", `---\ntitle: Slice\nproject: wiki-forge\ntype: forge-slice\ntask_id: WIKI-FORGE-001\nstatus: in-progress\n---\n# Slice\n`));

    expect(decoded).toEqual({
      status: "quarantined",
      diagnostics: [
        {
          code: "UnknownLifecycleShape",
          message: "document path is outside Forge/** layout",
        },
      ],
    });
  });
});

describe("forge handover rendering", () => {
  test("renders structured handover and copy/paste prompt", () => {
    const handover: ForgeHandoverRecord = {
      kind: "handover",
      path: "projects/wiki-forge/forge/handovers/2026-handover.md",
      title: "Handover",
      project: "wiki-forge",
      sessionId: "2026-handover",
      createdAt: "2026-04-28T00:00:00.000Z",
      agent: "pi",
      relatedFeatures: ["FEAT-001"],
      relatedPrds: ["PRD-001"],
      relatedSlices: ["WIKI-FORGE-001"],
      summary: "Created no-fallback dogfood artifacts.",
      nextAction: "Implement Forge path and schema primitives.",
      copyPastePrompt: "Continue Forge. Do not add fallback.",
    };

    const markdown = renderForgeHandoverMarkdown(handover);

    expect(markdown).toContain("type: forge-handover");
    expect(markdown).toContain("related_features:");
    expect(markdown).toContain("## Copy/paste prompt for next session");
    expect(markdown).toContain("Continue Forge. Do not add fallback.");
  });
});
