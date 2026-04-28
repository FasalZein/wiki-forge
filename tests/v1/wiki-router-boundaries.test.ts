import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

describe("V1 wiki router boundaries", () => {
  test("top-level wiki router does not import legacy slice workflow modules", () => {
    const source = readFileSync(join(repoRoot, "src", "wiki", "index.ts"), "utf8");

    expect(source).not.toContain('from "../slice"');
    expect(source).not.toContain('from "../slice/pipeline"');
    expect(source).not.toContain("repairHistoricalDoneSlices");
  });
});
