import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { resolveForgeCommand } from "../../src/forge";

describe("V1 forge router", () => {
  test("public forge router imports stable Forge commands instead of legacy or V1 implementation modules", () => {
    const source = readFileSync(join(repoRoot, "src", "forge", "index.ts"), "utf8");

    expect(source).toContain('from "./workflow/commands"');
    expect(source).not.toContain('from "../v1/cli/commands"');
    expect(source).not.toContain('from "../slice/forge"');
  });

  test("legacy-only forge subcommands are not part of the runtime router", () => {
    expect(() => resolveForgeCommand(["open", "demo", "DEMO-001"])).toThrow("unknown forge subcommand");
    expect(() => resolveForgeCommand(["skip", "demo", "DEMO-001"])).toThrow("unknown forge subcommand");
  });
});
