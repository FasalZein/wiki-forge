import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REMOVED_FILES = [
  "src/hierarchy/start-feature.ts",
  "src/hierarchy/close-feature.ts",
  "src/hierarchy/start-prd.ts",
  "src/hierarchy/close-prd.ts",
  "src/hierarchy/lifecycle/start-feature.ts",
  "src/hierarchy/lifecycle/close-feature.ts",
  "src/hierarchy/lifecycle/start-prd.ts",
  "src/hierarchy/lifecycle/close-prd.ts",
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

describe("legacy feature/PRD planning lifecycle removal", () => {
  test("deletes legacy feature and PRD lifecycle command adapters", () => {
    for (const file of REMOVED_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
  });

  test("planning facade exposes parsers/helpers only, not spec mutators", () => {
    const source = readFileSync(join(repoRoot, "src", "hierarchy", "planning.ts"), "utf8");
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
