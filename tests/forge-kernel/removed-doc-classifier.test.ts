import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { decodeForgeRecord } from "../../src/forge/vault/records";
import { parseVaultDocument } from "../../src/forge/vault/frontmatter-codec";

const oldSpecsSliceMarkdown = `---
title: WIKI-FORGE-213 old specs slice
type: spec
spec_kind: task-hub
project: wiki-forge
task_id: WIKI-FORGE-213
status: in-progress
---
# WIKI-FORGE-213
`;

describe("removed forge old document classifier", () => {
  test("legacy classifier module is deleted", () => {
    expect(existsSync(join(repoRoot, "src", "forge", "vault", "legacy-classifier.ts"))).toBe(false);
  });

  test("old specs slice documents are quarantined by canonical Forge decoding", () => {
    const document = parseVaultDocument("projects/wiki-forge/specs/slices/WIKI-FORGE-213/index.md", oldSpecsSliceMarkdown);

    expect(decodeForgeRecord(document).status).toBe("quarantined");
  });
});
