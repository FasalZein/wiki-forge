import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { resolveForgeCommand } from "../../src/forge";

describe("Forge router", () => {
  test("public forge router imports stable Forge commands instead of removed or implementation modules", () => {
    const source = readFileSync(join(repoRoot, "src", "forge", "index.ts"), "utf8");

    expect(source).toContain('from "./workflow/commands"');
    expect(source).not.toContain('from "../forge/cli/commands"');
    expect(source).not.toContain('from "../slice/forge"');
  });

  test("legacy migration modules are absent from the runtime codebase", () => {
    expect(existsSync(join(repoRoot, "src", "forge", "migration"))).toBe(false);
    expect(existsSync(join(repoRoot, "src", "forge", "vault", "legacy-classifier.ts"))).toBe(false);
  });

  test("removed-only forge subcommands are not part of the runtime router", () => {
    expect(() => resolveForgeCommand(["open", "demo", "DEMO-001"])).toThrow("unknown forge subcommand");
    expect(() => resolveForgeCommand(["skip", "demo", "DEMO-001"])).toThrow("unknown forge subcommand");
  });
});
