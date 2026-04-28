import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { resolveForgeCommand } from "../../src/forge";

describe("V1 forge router", () => {
  test("public forge router imports V1 commands directly instead of slice/forge legacy router", () => {
    const source = readFileSync(join(repoRoot, "src", "forge", "index.ts"), "utf8");

    expect(source).toContain('from "../v1/cli/commands"');
    expect(source).not.toContain('from "../slice/forge"');
  });

  test("legacy-only forge subcommands are not part of the runtime router", () => {
    expect(() => resolveForgeCommand(["open", "demo", "DEMO-001"])).toThrow("unknown forge subcommand");
    expect(() => resolveForgeCommand(["skip", "demo", "DEMO-001"])).toThrow("unknown forge subcommand");
  });
});
