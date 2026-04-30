import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_helpers/wiki-subprocess";

describe("Wiki-owned source layout", () => {
  test("retrieval lives inside the Wiki bounded context", () => {
    expect(existsSync(join(repoRoot, "src/wiki/retrieval"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/retrieval"))).toBe(false);
  });

  test("research lives inside the Wiki bounded context", () => {
    expect(existsSync(join(repoRoot, "src/wiki/research"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/research"))).toBe(false);
  });

  test("verification lives inside the Wiki bounded context", () => {
    expect(existsSync(join(repoRoot, "src/wiki/verification"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/verification"))).toBe(false);
  });
});
