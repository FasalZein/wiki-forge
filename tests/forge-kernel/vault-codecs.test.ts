import { describe, expect, test } from "bun:test";
import { decodeForgeRecord, parseVaultDocument } from "../../src/forge/vault/records";

const validSliceMarkdown = `---
title: WIKI-FORGE-213 forge vault codecs and legacy classifier
type: forge-slice
project: wiki-forge
task_id: WIKI-FORGE-213
status: in-progress
parent_prd: PRD-090
parent_feature: FEAT-049
source_paths:
  - src/forge/vault/document.ts
  - tests/forge-kernel/vault-codecs.test.ts
---
# WIKI-FORGE-213
`;

const validPrdMarkdown = `---
title: Canonical forge records
project: wiki-forge
type: forge-prd
prd_id: PRD-090
parent_feature: FEAT-049
status: draft
slice_ids:
  - WIKI-FORGE-213
---
# PRD-090
`;

describe("forge vault records", () => {
  test("valid current-style slice hub decodes through the canonical Forge record decoder", () => {
    const document = parseVaultDocument("projects/wiki-forge/forge/slices/WIKI-FORGE-213/index.md", validSliceMarkdown);
    const decoded = decodeForgeRecord(document);

    expect(decoded.status).toBe("valid");
    if (decoded.status !== "valid") throw new Error("expected valid slice");
    expect(decoded.record).toEqual({
      kind: "slice",
      path: "projects/wiki-forge/forge/slices/WIKI-FORGE-213/index.md",
      project: "wiki-forge",
      taskId: "WIKI-FORGE-213",
      title: "WIKI-FORGE-213 forge vault codecs and legacy classifier",
      status: "in-progress",
      createdAt: "",
      updatedAt: "",
      parentPrd: "PRD-090",
      parentFeature: "FEAT-049",
      sourcePaths: ["src/forge/vault/document.ts", "tests/forge-kernel/vault-codecs.test.ts"],
    });
  });

  test("valid PRD decodes through the canonical Forge record decoder", () => {
    const document = parseVaultDocument("projects/wiki-forge/forge/prds/PRD-090-canonical-forge-records.md", validPrdMarkdown);
    const decoded = decodeForgeRecord(document);

    expect(decoded.status).toBe("valid");
    if (decoded.status !== "valid") throw new Error("expected valid PRD");
    expect(decoded.record.kind).toBe("prd");
    expect(decoded.record.project).toBe("wiki-forge");
    expect(decoded.record.sliceIds).toEqual(["WIKI-FORGE-213"]);
  });

  test("missing task_id becomes repairable with exact diagnostic", () => {
    const document = parseVaultDocument("projects/wiki-forge/forge/slices/WIKI-FORGE-213/index.md", validSliceMarkdown.replace("task_id: WIKI-FORGE-213\n", ""));
    const decoded = decodeForgeRecord(document);

    expect(decoded).toEqual({
      status: "repairable",
      diagnostics: [
        {
          code: "MissingRequiredField",
          field: "task_id",
          message: "slice record is missing required field: task_id",
        },
      ],
    });
  });

  test("project identity mismatch becomes repairable with exact diagnostic", () => {
    const document = parseVaultDocument("projects/wiki-forge/forge/slices/WIKI-FORGE-213/index.md", validSliceMarkdown.replace("project: wiki-forge", "project: old-name"));
    const decoded = decodeForgeRecord(document);

    expect(decoded).toEqual({
      status: "repairable",
      diagnostics: [
        {
          code: "ProjectMismatch",
          field: "project",
          message: "frontmatter project old-name does not match path project wiki-forge",
        },
      ],
    });
  });
});
