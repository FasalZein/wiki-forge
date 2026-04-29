import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { listCommandSurfaceEntries } from "../../src/wiki/runtime/command-surface";
import { WIKI_COMMANDS, resolveWikiCommand } from "../../src/wiki";

const REMOVED_COMPATIBILITY_FILES = [
  "src/wiki/runtime/compat.ts",
  "src/v1/cli/legacy-compat.ts",
];

describe("final Forge promotion", () => {
  test("public v1 namespace and compatibility inspector are removed", () => {
    for (const file of REMOVED_COMPATIBILITY_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
    expect(WIKI_COMMANDS["v1:compat"]).toBeUndefined();
    expect(WIKI_COMMANDS["v1:forge:run"]).toBeUndefined();
    expect(resolveWikiCommand(["v1", "compat", "wiki", "forge", "run"])).toEqual({
      command: "v1",
      args: ["compat", "wiki", "forge", "run"],
    });
  });

  test("command surface advertises stable Forge commands instead of v1 aliases", () => {
    const publicCommands = listCommandSurfaceEntries().flatMap((entry) => entry.publicCommands);
    expect(publicCommands).toContain("forge");
    expect(publicCommands).not.toContain("v1");
    expect(publicCommands).not.toContain("v1:compat");
    expect(publicCommands).not.toContain("v1:forge:run");
  });

  test("README documents stable Forge commands only", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("wiki forge run <project> [slice-id] --repo <path>");
    expect(readme).not.toContain("wiki v1 forge");
    expect(readme).not.toContain("wiki v1 compat");
    expect(readme).not.toContain("V1 read-only projection path");
  });
});
