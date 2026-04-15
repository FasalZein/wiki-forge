import { describe, expect, test } from "bun:test";
import { slugify } from "../src/commands/planning";

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
