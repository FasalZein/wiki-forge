import { describe, expect, test } from "bun:test";
import { findProjectArg, parseProjectRepoArgs, parseProjectRepoBaseArgs } from "../src/git-utils";
import { isTestFile } from "../src/maintenance/test-health";

describe("findProjectArg", () => {
  test("keeps the leading project arg while ignoring repo/base flag values later", () => {
    expect(findProjectArg(["wiki-forge", "--repo", "/tmp/repo", "--base", "main", "--json"])).toBe("wiki-forge");
  });
});

describe("parseProjectRepoArgs", () => {
  test("parses project and repo while ignoring trailing flags", () => {
    expect(parseProjectRepoArgs(["wiki-forge", "--repo", "/tmp/repo", "--json"])).toEqual({ project: "wiki-forge", repo: "/tmp/repo" });
  });

  test("throws when --repo has no value", () => {
    expect(() => parseProjectRepoArgs(["wiki-forge", "--repo"]))
      .toThrow("missing repo");
  });
});

describe("parseProjectRepoBaseArgs", () => {
  test("parses explicit base without needing repo inspection", async () => {
    await expect(parseProjectRepoBaseArgs(["wiki-forge", "--repo", "/tmp/repo", "--base", "main", "--json"]))
      .resolves.toEqual({ project: "wiki-forge", repo: "/tmp/repo", base: "main" });
  });

  test("throws when --base has no value", async () => {
    await expect(parseProjectRepoBaseArgs(["wiki-forge", "--base"]))
      .rejects.toThrow("missing base");
  });
});

describe("isTestFile", () => {
  test("identifies files in tests/ directory", () => {
    expect(isTestFile("tests/foo.ts")).toBe(true);
    expect(isTestFile("tests/bar.test.ts")).toBe(true);
  });

  test("identifies files in test/ directory", () => {
    expect(isTestFile("test/foo.ts")).toBe(true);
  });

  test("identifies files in __tests__ directory", () => {
    expect(isTestFile("src/__tests__/foo.ts")).toBe(true);
  });

  test("identifies files with .test. in name", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("src/foo.test.js")).toBe(true);
  });

  test("identifies files with .spec. in name", () => {
    expect(isTestFile("src/foo.spec.ts")).toBe(true);
  });

  test("identifies Python test_ prefix pattern", () => {
    expect(isTestFile("src/test_foo.py")).toBe(true);
  });

  test("does not match regular source files", () => {
    expect(isTestFile("src/commands/maintenance.ts")).toBe(false);
    expect(isTestFile("src/lib/fs.ts")).toBe(false);
    expect(isTestFile("src/index.ts")).toBe(false);
  });

  test("does not match files that merely contain 'test' in name", () => {
    expect(isTestFile("src/testimony.ts")).toBe(false);
    expect(isTestFile("src/contest.ts")).toBe(false);
  });
});
