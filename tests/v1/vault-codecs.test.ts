import { describe, expect, test } from "bun:test";
import { decodeProjectRecord, decodeSliceRecord, parseVaultDocument } from "../../src/v1/vault/frontmatter-codec";

const validSliceMarkdown = `---
title: WIKI-FORGE-213 v1 vault codecs and legacy classifier
type: spec
spec_kind: task-hub
project: wiki-forge
task_id: WIKI-FORGE-213
status: in-progress
parent_prd: PRD-090
parent_feature: FEAT-049
source_paths:
  - src/v1/vault/document.ts
  - tests/v1/vault-codecs.test.ts
---
# WIKI-FORGE-213
`;

const validProjectMarkdown = `---
title: Wiki Forge
project: wiki-forge
type: project
source_paths:
  - src/index.ts
---
# Wiki Forge
`;

describe("v1 vault frontmatter codecs", () => {
  test("valid current-style slice hub decodes into a typed SliceRecord", () => {
    const document = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-213/index.md", validSliceMarkdown);
    const decoded = decodeSliceRecord(document);

    expect(decoded.status).toBe("valid");
    if (decoded.status !== "valid") throw new Error("expected valid slice");
    expect(decoded.record).toEqual({
      kind: "slice",
      path: "projects/wiki-forge/specs/slices/WIKI-FORGE-213/index.md",
      project: "wiki-forge",
      taskId: "WIKI-FORGE-213",
      title: "WIKI-FORGE-213 v1 vault codecs and legacy classifier",
      status: "in-progress",
      specKind: "task-hub",
      parentPrd: "PRD-090",
      parentFeature: "FEAT-049",
      sourcePaths: ["src/v1/vault/document.ts", "tests/v1/vault-codecs.test.ts"],
    });
  });

  test("valid current-style project doc decodes into a typed ProjectRecord", () => {
    const document = parseVaultDocument("projects/wiki-forge/index.md", validProjectMarkdown);
    const decoded = decodeProjectRecord(document);

    expect(decoded.status).toBe("valid");
    if (decoded.status !== "valid") throw new Error("expected valid project");
    expect(decoded.record.kind).toBe("project");
    expect(decoded.record.project).toBe("wiki-forge");
    expect(decoded.record.sourcePaths).toEqual(["src/index.ts"]);
  });

  test("missing task_id becomes repairable with exact diagnostic", () => {
    const document = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-213/index.md", validSliceMarkdown.replace("task_id: WIKI-FORGE-213\n", ""));
    const decoded = decodeSliceRecord(document);

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
    const document = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-213/index.md", validSliceMarkdown.replace("project: wiki-forge", "project: old-name"));
    const decoded = decodeSliceRecord(document);

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
