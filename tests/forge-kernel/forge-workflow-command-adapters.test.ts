import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

describe("Forge workflow command adapters", () => {
  test("keeps the root commands module as a small public adapter", () => {
    const source = readFileSync(join(repoRoot, "src", "forge", "workflow", "commands.ts"), "utf8");
    const nonEmptyLines = source.split("\n").filter((line) => line.trim().length > 0);

    expect(nonEmptyLines.length).toBeLessThanOrEqual(80);
    expect(source).toContain("import { forgePlanCommand } from \"./plan-command\"");
    expect(source).toContain("import { forgeGrillCommand } from \"./grill-command\"");
    expect(source).toContain("./lifecycle-commands");
    expect(source).toContain("./evidence-commands");
    expect(source).toContain("export {");
  });
});
