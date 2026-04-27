import { describe, expect, test } from "bun:test";
import { collectSliceOwnershipMap, DEFAULT_IGNORED_GENERATED_PATH_SEGMENTS, SLICE_OWNERSHIP_KINDS } from "../src/forge/core/ownership-map";

describe("slice ownership map", () => {
  test("keeps the full ownership kind surface for future expansion", () => {
    expect(SLICE_OWNERSHIP_KINDS).toEqual([
      "ignored-generated",
      "active-slice",
      "other-open-slice",
      "closed-slice-amendment",
      "unowned",
    ]);
  });

  test("classifies active slice, ignored/generated, and unowned files", () => {
    const map = collectSliceOwnershipMap({
      changedFiles: [
        "src/payments.ts",
        "src/payments/helpers.ts",
        "coverage/lcov.info",
        "node_modules/pkg/index.js",
        ".venv/bin/python",
        "notes/todo.txt",
      ],
      activeSliceId: "DEMO-001",
      activeClaimPaths: ["src/payments"],
    });

    expect(map.entries).toEqual([
      { file: ".venv/bin/python", kind: "ignored-generated" },
      { file: "coverage/lcov.info", kind: "ignored-generated" },
      { file: "node_modules/pkg/index.js", kind: "ignored-generated" },
      { file: "notes/todo.txt", kind: "unowned" },
      { file: "src/payments.ts", kind: "unowned" },
      { file: "src/payments/helpers.ts", kind: "active-slice", matchedClaimPath: "src/payments", ownerSliceId: "DEMO-001" },
    ]);
    expect(map.counts).toEqual({
      "ignored-generated": 3,
      "active-slice": 1,
      "other-open-slice": 0,
      "closed-slice-amendment": 0,
      unowned: 2,
    });
  });

  test("includes the default ignored/generated path segments", () => {
    expect(DEFAULT_IGNORED_GENERATED_PATH_SEGMENTS).toEqual([
      ".venv",
      "node_modules",
      ".local-dev",
      "site-packages",
      "coverage",
      "dist",
      "build",
      ".qa-screens",
      "__pycache__",
    ]);
  });
});
