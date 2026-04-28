import { describe, expect, test } from "bun:test";
import { decodeV1ForgeRecord } from "../../src/v1/vault/records";
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
  isV1ForgePath,
} from "../../src/v1/vault/forge-paths";
import { parseVaultDocument } from "../../src/v1/vault/frontmatter-codec";
import { renderV1HandoverMarkdown } from "../../src/v1/handover/render";
import type { V1HandoverRecord } from "../../src/v1/handover/schema";

describe("v1 forge no-fallback paths", () => {
  test("builds only projects/<project>/forge/** paths", () => {
    expect(forgeFeaturePath("wiki-forge", "FEAT-V1-001", "dogfood")).toBe("projects/wiki-forge/forge/features/FEAT-V1-001-dogfood.md");
    expect(forgePrdPath("wiki-forge", "PRD-V1-001", "first-layer")).toBe("projects/wiki-forge/forge/prds/PRD-V1-001-first-layer.md");
    expect(forgeSliceDir("wiki-forge", "WIKI-FORGE-V1-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-V1-001");
    expect(forgeSlicePath("wiki-forge", "WIKI-FORGE-V1-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-V1-001/index.md");
    expect(forgeSlicePlanPath("wiki-forge", "WIKI-FORGE-V1-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-V1-001/plan.md");
    expect(forgeSliceTestPlanPath("wiki-forge", "WIKI-FORGE-V1-001")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-V1-001/test-plan.md");
    expect(forgeEvidencePath("wiki-forge", "WIKI-FORGE-V1-001")).toBe("projects/wiki-forge/forge/evidence/WIKI-FORGE-V1-001.md");
    expect(forgePlanningSessionPath("wiki-forge", "2026-dogfood")).toBe("projects/wiki-forge/forge/sessions/2026-dogfood.md");
    expect(forgeHandoverPath("wiki-forge", "2026-handover")).toBe("projects/wiki-forge/forge/handovers/2026-handover.md");
  });

  test("identifies specs paths as outside V1 forge instead of fallback", () => {
    expect(isV1ForgePath("projects/wiki-forge/forge/slices/WIKI-FORGE-V1-001/index.md")).toBe(true);
    expect(isV1ForgePath("projects/wiki-forge/specs/slices/WIKI-FORGE-V1-001/index.md")).toBe(false);
  });
});

describe("v1 forge records", () => {
  test("decodes feature, PRD, slice, evidence, and handover records", () => {
    const records = [
      parseVaultDocument("projects/wiki-forge/forge/features/FEAT-V1-001-dogfood.md", `---\ntitle: Dogfood\nproject: wiki-forge\ntype: forge-feature\nfeature_id: FEAT-V1-001\nstatus: draft\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nprd_ids:\n  - PRD-V1-001\n---\n# Dogfood\n`),
      parseVaultDocument("projects/wiki-forge/forge/prds/PRD-V1-001-first-layer.md", `---\ntitle: First layer\nproject: wiki-forge\ntype: forge-prd\nprd_id: PRD-V1-001\nparent_feature: FEAT-V1-001\nstatus: draft\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nslice_ids:\n  - WIKI-FORGE-V1-001\n---\n# First layer\n`),
      parseVaultDocument("projects/wiki-forge/forge/slices/WIKI-FORGE-V1-001/index.md", `---\ntitle: Slice\nproject: wiki-forge\ntype: forge-slice\ntask_id: WIKI-FORGE-V1-001\nparent_feature: FEAT-V1-001\nparent_prd: PRD-V1-001\nstatus: in-progress\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nsource_paths:\n  - src/v1/vault/records.ts\n---\n# Slice\n`),
      parseVaultDocument("projects/wiki-forge/forge/evidence/WIKI-FORGE-V1-001.md", `---\ntitle: Evidence\nproject: wiki-forge\ntype: forge-evidence\ntask_id: WIKI-FORGE-V1-001\nstatus: draft\ncreated_at: '2026-04-28T00:00:00.000Z'\nupdated: '2026-04-28T00:00:00.000Z'\nrecords:\n  - kind: tdd\n    result: passed\n---\n# Evidence\n`),
      parseVaultDocument("projects/wiki-forge/forge/handovers/2026-handover.md", `---\ntitle: Handover\nproject: wiki-forge\ntype: forge-handover\nsession_id: 2026-handover\ncreated_at: '2026-04-28T00:00:00.000Z'\nagent: pi\nrelated_features:\n  - FEAT-V1-001\nrelated_prds:\n  - PRD-V1-001\nrelated_slices:\n  - WIKI-FORGE-V1-001\nnext_action: Continue V1\n---\n# Handover\n`),
    ].map(decodeV1ForgeRecord);

    expect(records.map((record) => record.status)).toEqual(["valid", "valid", "valid", "valid", "valid"]);
    expect(records.map((record) => record.status === "valid" ? record.record.kind : null)).toEqual(["feature", "prd", "slice", "evidence", "handover"]);
  });

  test("quarantines legacy specs slice paths instead of decoding them", () => {
    const decoded = decodeV1ForgeRecord(parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-V1-001/index.md", `---\ntitle: Slice\nproject: wiki-forge\ntype: forge-slice\ntask_id: WIKI-FORGE-V1-001\nstatus: in-progress\n---\n# Slice\n`));

    expect(decoded).toEqual({
      status: "quarantined",
      diagnostics: [
        {
          code: "UnknownLifecycleShape",
          message: "document path is outside V1 forge/** layout",
        },
      ],
    });
  });
});

describe("v1 handover rendering", () => {
  test("renders structured handover and copy/paste prompt", () => {
    const handover: V1HandoverRecord = {
      kind: "handover",
      path: "projects/wiki-forge/forge/handovers/2026-handover.md",
      title: "Handover",
      project: "wiki-forge",
      sessionId: "2026-handover",
      createdAt: "2026-04-28T00:00:00.000Z",
      agent: "pi",
      relatedFeatures: ["FEAT-V1-001"],
      relatedPrds: ["PRD-V1-001"],
      relatedSlices: ["WIKI-FORGE-V1-001"],
      summary: "Created no-fallback dogfood artifacts.",
      nextAction: "Implement V1 path and schema primitives.",
      copyPastePrompt: "Continue V1. Do not add fallback.",
    };

    const markdown = renderV1HandoverMarkdown(handover);

    expect(markdown).toContain("type: forge-handover");
    expect(markdown).toContain("related_features:");
    expect(markdown).toContain("## Copy/paste prompt for next session");
    expect(markdown).toContain("Continue V1. Do not add fallback.");
  });
});
