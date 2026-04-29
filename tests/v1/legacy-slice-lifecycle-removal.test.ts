import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REMOVED_FILES = [
  "src/slice/claim.ts",
  "src/slice/close.ts",
  "src/slice/verify.ts",
  "src/slice/slice-scaffold.ts",
  "src/slice/slice-repair.ts",
  "src/slice/coordination.ts",
  "src/slice/coordination/index.ts",
  "src/slice/coordination/claim.ts",
  "src/slice/lifecycle/close.ts",
];

const FORBIDDEN_TEXT = [
  "export async function startSlice(",
  "export async function createIssueSlice(",
  "export async function verifySlice(",
  "export async function closeSlice(",
  "export async function claimSlice(",
  "repairHistoricalDoneSlices",
];

describe("legacy slice lifecycle removal", () => {
  test("deletes legacy slice command adapter files", () => {
    for (const file of REMOVED_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
  });

  test("remaining slice helpers expose cores/readers, not command adapters", () => {
    const sources = [
      readFileSync(join(repoRoot, "src", "slice", "lifecycle", "start.ts"), "utf8"),
      readFileSync(join(repoRoot, "src", "slice", "docs", "scaffold.ts"), "utf8"),
      readFileSync(join(repoRoot, "src", "slice", "index.ts"), "utf8"),
    ];

    for (const source of sources) {
      for (const text of FORBIDDEN_TEXT) expect(source).not.toContain(text);
    }
    expect(sources.join("\n")).toContain("startSliceCore");
    expect(sources.join("\n")).toContain("createIssueSliceCore");
  });
});
