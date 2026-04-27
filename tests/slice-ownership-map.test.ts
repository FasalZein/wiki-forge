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
        "tests/payments.test.ts",
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
      { file: "tests/payments.test.ts", kind: "active-slice", matchedClaimPath: "test-support", ownerSliceId: "DEMO-001" },
    ]);
    expect(map.counts).toEqual({
      "ignored-generated": 3,
      "active-slice": 2,
      "other-open-slice": 0,
      "closed-slice-amendment": 0,
      unowned: 2,
    });
  });

  test("classifies closed slice amendment files separately from active slice claims", () => {
    const map = collectSliceOwnershipMap({
      changedFiles: ["src/payments.ts", "src/profile.ts"],
      activeSliceId: "DEMO-002",
      activeClaimPaths: ["src/payments.ts", "src/profile.ts"],
      closedSliceAmendments: [{ sliceId: "DEMO-001", claimPaths: ["src/payments.ts"] }],
    });

    expect(map.entries).toEqual([
      { file: "src/payments.ts", kind: "closed-slice-amendment", matchedClaimPath: "src/payments.ts", ownerSliceId: "DEMO-001" },
      { file: "src/profile.ts", kind: "active-slice", matchedClaimPath: "src/profile.ts", ownerSliceId: "DEMO-002" },
    ]);
    expect(map.counts["closed-slice-amendment"]).toBe(1);
    expect(map.counts["active-slice"]).toBe(1);
    expect(map.counts.unowned).toBe(0);
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
