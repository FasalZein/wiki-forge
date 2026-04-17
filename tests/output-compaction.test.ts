import { describe, expect, test } from "bun:test";
import { collapseActions, compactMaintainForJson } from "../src/maintenance";

describe("collapseActions", () => {
  test("leaves singletons expanded", () => {
    const actions = [
      { kind: "active-task", message: "WIKI-FORGE-102 output compaction" },
      { kind: "bind-page", message: "specs/foo.md has no source_paths" },
    ];
    expect(collapseActions(actions)).toEqual([
      "[active-task] WIKI-FORGE-102 output compaction",
      "[bind-page] specs/foo.md has no source_paths",
    ]);
  });

  test("collapses repeated kinds to count + first-message summary", () => {
    const actions = [
      { kind: "move-doc-to-wiki", message: "repo markdown doc should live in wiki: docs/a.md" },
      { kind: "move-doc-to-wiki", message: "repo markdown doc should live in wiki: docs/b.md" },
      { kind: "move-doc-to-wiki", message: "repo markdown doc should live in wiki: docs/c.md" },
      { kind: "review-page", message: "page-x impacted" },
      { kind: "review-page", message: "page-y impacted" },
    ];
    const out = collapseActions(actions);
    expect(out).toEqual([
      "[move-doc-to-wiki] 3 items (first: repo markdown doc should live in wiki: docs/a.md)",
      "[review-page] 2 items (first: page-x impacted)",
    ]);
  });

  test("preserves first-seen kind order", () => {
    const actions = [
      { kind: "b", message: "b1" },
      { kind: "a", message: "a1" },
      { kind: "b", message: "b2" },
    ];
    expect(collapseActions(actions)).toEqual([
      "[b] 2 items (first: b1)",
      "[a] a1",
    ]);
  });
});

describe("compactMaintainForJson", () => {
  test("drops per-page diffSummary from impactedPages", () => {
    const result = {
      project: "demo",
      refreshFromGit: {
        impactedPages: [
          { page: "one.md", matchedSourcePaths: ["src/a.ts"], verificationLevel: null, diffSummary: ["+a", "-b"] },
          { page: "two.md", matchedSourcePaths: ["src/b.ts"], verificationLevel: null, diffSummary: ["+c"] },
        ],
        other: "kept",
      },
      rest: "kept",
    } as any;
    const compact: any = compactMaintainForJson(result);
    expect(compact.refreshFromGit.impactedPages[0]).not.toHaveProperty("diffSummary");
    expect(compact.refreshFromGit.impactedPages[0].page).toBe("one.md");
    expect(compact.refreshFromGit.other).toBe("kept");
    expect(compact.rest).toBe("kept");
  });
});
