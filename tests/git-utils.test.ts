import { describe, expect, test } from "bun:test";
import { findProjectArg, parseProjectRepoBaseArgs, normalizeRelPath, bindingMatchesFile } from "../src/commands/git-utils";

describe("git-utils helpers", () => {
  test("findProjectArg returns first positional argument", () => {
    expect(findProjectArg(["wiki-forge", "--base", "main"])).toBe("wiki-forge");
  });

  test("findProjectArg skips flag values", () => {
    expect(findProjectArg(["wiki-forge", "--repo", "/tmp/repo", "--base", "main"])).toBe("wiki-forge");
  });

  test("findProjectArg returns undefined when args array is empty", () => {
    expect(findProjectArg([])).toBeUndefined();
  });

  test("parseProjectRepoBaseArgs returns narrowed project string", async () => {
    const parsed = await parseProjectRepoBaseArgs(["wiki-forge", "--base", "main"]);
    // Runtime: values are present.
    expect(parsed.project).toBe("wiki-forge");
    expect(parsed.base).toBe("main");
    // Compile-time invariant: `project` and `base` are `string`, not `string | undefined`.
    // If the assertion signature of `requireValue` regresses (e.g., via dynamic import),
    // the following `satisfies` check would fail `tsc --noEmit`.
    const _narrowed = parsed.project satisfies string;
    const _narrowedBase = parsed.base satisfies string;
    expect(_narrowed.length).toBeGreaterThan(0);
    expect(_narrowedBase.length).toBeGreaterThan(0);
  });

  test("parseProjectRepoBaseArgs throws when args array is empty", async () => {
    await expect(parseProjectRepoBaseArgs([])).rejects.toThrow(/project/i);
  });

  test("normalizeRelPath converts backslashes to forward slashes", () => {
    expect(normalizeRelPath("src\\commands\\git-utils.ts")).toBe("src/commands/git-utils.ts");
  });

  test("bindingMatchesFile matches exact and prefix bindings", () => {
    expect(bindingMatchesFile("src/commands", "src/commands/git-utils.ts")).toBe(true);
    expect(bindingMatchesFile("src/commands/git-utils.ts", "src/commands/git-utils.ts")).toBe(true);
    expect(bindingMatchesFile("src/commands", "src/lib/fs.ts")).toBe(false);
  });
});
