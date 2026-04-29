import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { listCommandSurfaceEntries } from "../../src/wiki/runtime/command-surface";
import { WIKI_COMMANDS, resolveWikiCommand } from "../../src/wiki";

const REMOVED_COMPATIBILITY_FILES = [
  "src/wiki/runtime/compat.ts",
  "src/forge/cli/legacy-compat.ts",
];

describe("final Forge promotion", () => {
  test("public forge namespace and compatibility inspector are removed", () => {
    for (const file of REMOVED_COMPATIBILITY_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
    expect(WIKI_COMMANDS["forge:compat"]).toBeUndefined();
    expect(WIKI_COMMANDS["forge:forge:run"]).toBeUndefined();
    expect(resolveWikiCommand(["forge", "compat", "wiki", "forge", "run"])).toEqual({
      command: "forge",
      args: ["compat", "wiki", "forge", "run"],
    });
  });

  test("command surface advertises stable Forge commands without compatibility aliases", () => {
    const publicCommands = listCommandSurfaceEntries().flatMap((entry) => entry.publicCommands);
    expect(publicCommands).toContain("forge");
    expect(publicCommands).not.toContain("forge:compat");
    expect(publicCommands).not.toContain("forge:forge:run");
    expect(publicCommands).not.toContain("forge:compat");
    expect(publicCommands).not.toContain("forge:forge:run");
  });

  test("README documents stable Forge commands only", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("wiki forge run <project> [slice-id] --repo <path>");
    expect(readme).not.toContain("wiki forge compat");
    expect(readme).not.toContain("Forge read-only projection path");
  });
});
