import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REMOVED_PATHS = [
  "src/slice/claim.ts",
  "src/slice/close.ts",
  "src/slice/verify.ts",
  "src/slice/slice-scaffold.ts",
  "src/slice/slice-repair.ts",
  "src/slice/coordination.ts",
  "src/slice/coordination",
  "src/slice/lifecycle",
  "src/slice/forge",
  "src/slice/forge.ts",
  "src/slice/forge-output.ts",
  "src/slice/forge-planning.ts",
  "src/slice/start.ts",
];

describe("removed slice lifecycle guard", () => {
  test("deletes legacy slice runtime paths", () => {
    for (const path of REMOVED_PATHS) expect(existsSync(join(repoRoot, path))).toBe(false);
  });
});
