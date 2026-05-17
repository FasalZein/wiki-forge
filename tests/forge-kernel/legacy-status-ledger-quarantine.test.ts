import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

describe("legacy Forge status ledger retirement", () => {
  test("status workflow-ledger authority has been deleted", () => {
    expect(existsSync(join(repoRoot, "src/forge/status/workflow-ledger.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/forge/lifecycle/workflow-ledger.ts"))).toBe(true);
  });
});
