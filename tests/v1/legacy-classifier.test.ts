import { describe, expect, test } from "bun:test";
import { classifyLegacyDocument } from "../../src/v1/vault/legacy-classifier";
import { parseVaultDocument } from "../../src/v1/vault/frontmatter-codec";

const projectionMarkdown = `---
title: Backlog
type: projection
project: wiki-forge
generated: true
---
# Backlog
`;

const ambiguousMarkdown = `---
title: Random note
project: wiki-forge
---
# Random note
This note has project metadata but no lifecycle kind or stable id.
`;

const validSliceMarkdown = `---
title: WIKI-FORGE-213 v1 vault codecs and legacy classifier
type: spec
spec_kind: task-hub
project: wiki-forge
task_id: WIKI-FORGE-213
status: in-progress
---
# WIKI-FORGE-213
`;

describe("v1 legacy document classifier", () => {
  test("generated index/backlog projection is excluded from canonical lifecycle truth", () => {
    const document = parseVaultDocument("projects/wiki-forge/backlog.md", projectionMarkdown);
    const classification = classifyLegacyDocument(document);

    expect(classification).toEqual({
      status: "projection",
      canonical: false,
      reason: "generated or projection document is not lifecycle truth",
    });
  });

  test("ambiguous invalid document is quarantined with reason", () => {
    const document = parseVaultDocument("projects/wiki-forge/notes/random.md", ambiguousMarkdown);
    const classification = classifyLegacyDocument(document);

    expect(classification).toEqual({
      status: "quarantined",
      canonical: false,
      reason: "document does not match a V1 canonical lifecycle shape",
      diagnostics: [
        {
          code: "UnknownLifecycleShape",
          message: "document has project metadata but no recognized canonical record kind",
        },
      ],
    });
  });

  test("valid slice document is classified as canonical lifecycle truth", () => {
    const document = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-213/index.md", validSliceMarkdown);
    const classification = classifyLegacyDocument(document);

    expect(classification.status).toBe("valid");
    expect(classification.canonical).toBe(true);
    if (classification.status !== "valid") throw new Error("expected valid classification");
    expect(classification.record.kind).toBe("slice");
    expect(classification.record.taskId).toBe("WIKI-FORGE-213");
  });
});
