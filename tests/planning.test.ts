import { describe, expect, test } from "bun:test";
import { slugify, parsePrdArgs, parseProjectAndName } from "../src/commands/planning";

describe("slugify", () => {
  test("lowercases input", () => {
    expect(slugify("Auth Platform")).toBe("auth-platform");
  });

  test("replaces spaces with hyphens", () => {
    expect(slugify("my feature name")).toBe("my-feature-name");
  });

  test("replaces non-alphanumeric characters with hyphens", () => {
    expect(slugify("auth & billing: v2.0")).toBe("auth-billing-v2-0");
  });

  test("strips leading and trailing hyphens", () => {
    expect(slugify("  -leading and trailing-  ")).toBe("leading-and-trailing");
  });

  test("collapses consecutive hyphens into one", () => {
    expect(slugify("foo--bar___baz")).toBe("foo-bar-baz");
  });

  test("falls back to spec for empty input", () => {
    expect(slugify("")).toBe("spec");
    expect(slugify("---")).toBe("spec");
  });

  test("handles alphanumeric-only input unchanged (lowercased)", () => {
    expect(slugify("authmodule")).toBe("authmodule");
  });
});

describe("parsePrdArgs", () => {
  test("excludes --json flag from name", () => {
    const result = parsePrdArgs(["wiki-forge", "--feature", "FEAT-003", "durable", "handover", "artifact", "--json"]);
    expect(result.name).toBe("durable handover artifact");
  });

  test("parses feature, supersedes, and split-from flags", () => {
    const result = parsePrdArgs(["proj", "--feature", "FEAT-001", "--supersedes", "PRD-010", "--split-from", "PRD-005", "my", "prd"]);
    expect(result.featureId).toBe("FEAT-001");
    expect(result.supersedes).toBe("PRD-010");
    expect(result.splitFrom).toBe("PRD-005");
    expect(result.name).toBe("my prd");
  });
});

describe("parseProjectAndName", () => {
  test("excludes flags starting with -- from name", () => {
    const result = parseProjectAndName(["wiki-forge", "my", "feature", "--json"]);
    expect(result.name).toBe("my feature");
  });

  test("parses project and name without flags", () => {
    const result = parseProjectAndName(["proj", "some", "name"]);
    expect(result.project).toBe("proj");
    expect(result.name).toBe("some name");
  });
});
