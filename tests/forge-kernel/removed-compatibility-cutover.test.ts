import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { WIKI_COMMANDS, resolveWikiCommand } from "../../src/wiki";

describe("compatibility cutover", () => {
  test("public forge compatibility command namespace is removed", () => {
    expect(resolveWikiCommand(["forge", "compat", "wiki", "forge", "next"])).toEqual({
      command: "forge",
      args: ["compat", "wiki", "forge", "next"],
    });
    expect(WIKI_COMMANDS["forge:compat"]).toBeUndefined();
    expect(WIKI_COMMANDS["forge:forge:next"]).toBeUndefined();
  });

  test("stable commands remain the public surface", () => {
    expect(typeof WIKI_COMMANDS.next).toBe("function");
    expect(typeof WIKI_COMMANDS.resume).toBe("function");
    expect(typeof WIKI_COMMANDS.handover).toBe("function");
  });

  test("old specs import compatibility modules are removed", () => {
    expect(existsSync(join(repoRoot, "src", "forge", "migration", "import-project.ts"))).toBe(false);
  });
});
