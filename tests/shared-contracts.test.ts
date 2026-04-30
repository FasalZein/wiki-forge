import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_helpers/wiki-subprocess";

describe("shared contracts", () => {
  test("command and frontmatter contracts are canonical shared contracts", () => {
    const sharedCommand = readRepoFile("src/shared/contracts/command.ts");
    const sharedFrontmatter = readRepoFile("src/shared/contracts/frontmatter.ts");
    const rootTypes = readRepoFile("src/types.ts");

    expect(sharedCommand).toContain("export type CommandHandler");
    expect(sharedFrontmatter).toContain("export type FrontmatterData");
    expect(rootTypes).not.toContain("export type CommandHandler =");
    expect(rootTypes).not.toContain("export type FrontmatterData =");
  });
});

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}
