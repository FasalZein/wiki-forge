import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REMOVED_FILES = [
  "src/lib/pipeline-state.ts",
  "src/slice/pipeline.ts",
  "src/slice/pipeline-plan.ts",
  "src/slice/pipeline-runner.ts",
  "src/slice/forge-run.ts",
  "src/slice/forge/run.ts",
  "src/slice/pipeline/index.ts",
  "src/slice/pipeline/plan.ts",
  "src/slice/pipeline/progress.ts",
  "src/slice/pipeline/runner.ts",
  "src/slice/forge/output.ts",
];

const FORBIDDEN_HELP = [
  "wiki pipeline <project>",
  "wiki pipeline-reset <project>",
];

describe("legacy pipeline orchestration removal", () => {
  test("deletes legacy pipeline orchestration files", () => {
    for (const file of REMOVED_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
  });

  test("help no longer advertises pipeline commands", () => {
    const help = readFileSync(join(repoRoot, "src", "cli-shared.ts"), "utf8");
    for (const text of FORBIDDEN_HELP) expect(help).not.toContain(text);
    expect(help).toContain("wiki forge run");
  });
});
