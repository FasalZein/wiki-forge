import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const TRIAGE_PATH = "docs/desloppify-complexity-triage.md";

describe("desloppify complexity triage", () => {
  test("documents the remaining long-file finding as an explicit follow-up instead of a blind split", () => {
    const triage = readFileSync(TRIAGE_PATH, "utf8");

    expect(triage).toContain("Current score: 98/100");
    expect(triage).toContain("src/forge/workflow/commands.ts");
    expect(triage).toContain("LONG_FILE");
    expect(triage).toContain("Do not split this file solely to satisfy the metric");
    expect(triage).toContain("Create a dedicated Forge slice before extracting command groups");
    expect(triage).toContain("Targeted tests must cover every moved command adapter");
  });
});
