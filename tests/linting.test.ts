import { describe, expect, test } from "bun:test";
import { collectSemanticLintResult, type LintingSnapshot } from "../src/verification/linting";

function makeSnapshot(entries: Array<{ relPath: string; raw: string }>): LintingSnapshot {
  return {
    project: "test-proj",
    root: "/tmp/test-vault/projects/test-proj",
    pages: entries.map((e) => e.relPath),
    pageEntries: entries.map((e) => ({
      file: `/tmp/test-vault/projects/test-proj/${e.relPath}`,
      relPath: e.relPath,
      vaultPath: `projects/test-proj/${e.relPath}`,
      raw: e.raw,
      parsed: null as any,
      sourcePaths: [],
      rawUpdated: null,
      verificationLevel: null,
    })),
  };
}

describe("collectSemanticLintResult", () => {
  test("flags regular page with 6+ TODO markers as placeholder-heavy", async () => {
    const raw = "---\ntitle: test\n---\n# Page\nTODO one\nTODO two\nTODO three\nTODO four\nTODO five\nTODO six\n";
    const snapshot = makeSnapshot([{ relPath: "modules/some-module.md", raw }]);
    const result = await collectSemanticLintResult("test-proj", snapshot);
    expect(result.issues.some((i) => i.includes("placeholder-heavy"))).toBe(true);
  });

  test("does NOT flag slice plan page with 6-11 TODO markers", async () => {
    const raw = "---\ntitle: test plan\ntype: spec\n---\n# Plan\n[[projects/test-proj/_summary]]\nTODO migrate foo\nTODO migrate bar\nTODO migrate baz\nTODO migrate qux\nTODO migrate quux\nTODO migrate corge\nTODO migrate grault\nTODO migrate garply\n";
    const snapshot = makeSnapshot([{ relPath: "specs/slices/PROJ-085/plan.md", raw }]);
    const result = await collectSemanticLintResult("test-proj", snapshot);
    const placeholderIssues = result.issues.filter((i) => i.includes("placeholder-heavy"));
    expect(placeholderIssues).toEqual([]);
  });

  test("does NOT flag slice test-plan page with 6-11 TODO markers", async () => {
    const raw = "---\ntitle: test plan\ntype: spec\n---\n# Test Plan\n[[projects/test-proj/_summary]]\nTODO verify foo\nTODO verify bar\nTODO verify baz\nTODO verify qux\nTODO verify quux\nTODO verify corge\nTODO verify grault\n";
    const snapshot = makeSnapshot([{ relPath: "specs/slices/PROJ-085/test-plan.md", raw }]);
    const result = await collectSemanticLintResult("test-proj", snapshot);
    const placeholderIssues = result.issues.filter((i) => i.includes("placeholder-heavy"));
    expect(placeholderIssues).toEqual([]);
  });

  test("still flags slice plan page with 12+ TODO markers", async () => {
    const todos = Array.from({ length: 12 }, (_, i) => `TODO item ${i + 1}`).join("\n");
    const raw = `---\ntitle: test plan\ntype: spec\n---\n# Plan\n[[projects/test-proj/_summary]]\n${todos}\n`;
    const snapshot = makeSnapshot([{ relPath: "specs/slices/PROJ-085/plan.md", raw }]);
    const result = await collectSemanticLintResult("test-proj", snapshot);
    expect(result.issues.some((i) => i.includes("placeholder-heavy"))).toBe(true);
  });
});
