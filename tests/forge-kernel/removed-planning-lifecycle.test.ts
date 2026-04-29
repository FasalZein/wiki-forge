import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REMOVED_FILES = [
  "src/wiki/project-views/start-feature.ts",
  "src/wiki/project-views/close-feature.ts",
  "src/wiki/project-views/start-prd.ts",
  "src/wiki/project-views/close-prd.ts",
  "src/wiki/project-views/lifecycle/start-feature.ts",
  "src/wiki/project-views/lifecycle/close-feature.ts",
  "src/wiki/project-views/lifecycle/start-prd.ts",
  "src/wiki/project-views/lifecycle/close-prd.ts",
];

const FORBIDDEN_EXPORTS = [
  "createFeature",
  "createPrd",
  "createPlan",
  "createTestPlan",
  "createFeatureReturningId",
  "createPrdReturningId",
  "startFeature",
  "closeFeature",
  "startPrd",
  "closePrd",
];

describe("removed feature/PRD planning lifecycle guard", () => {
  test("deletes legacy feature and PRD lifecycle command adapters", () => {
    for (const file of REMOVED_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
  });

  test("planning facade exposes parsers/helpers only, not spec mutators", () => {
    const source = readFileSync(join(repoRoot, "src", "wiki", "project-views", "planning.ts"), "utf8");
    for (const name of FORBIDDEN_EXPORTS) expect(source).not.toContain(name);
    expect(source).toContain("parsePrdArgs");
    expect(source).toContain("parseProjectAndName");
    expect(source).toContain("slugify");
  });

  test("help points at Forge planning instead of legacy specs creation/lifecycle", () => {
    const source = readFileSync(join(repoRoot, "src", "cli-shared.ts"), "utf8");
    expect(source).not.toContain("wiki create-feature");
    expect(source).not.toContain("wiki create-prd");
    expect(source).not.toContain("wiki create-plan");
    expect(source).not.toContain("wiki create-test-plan");
    expect(source).not.toContain("wiki start-feature");
    expect(source).not.toContain("wiki close-feature");
    expect(source).not.toContain("wiki start-prd");
    expect(source).not.toContain("wiki close-prd");
    expect(source).toContain("wiki forge plan");
  });
});
