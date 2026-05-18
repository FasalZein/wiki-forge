import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const REMOVED_ONE_OFF_SCRIPTS = [
  "scripts/rebind-prd-043.ts",
];

const REMOVED_SCRIPT_REFERENCES = [
  "src/commands/backlog.ts",
  "src/commands/pipeline.ts",
  "After slice 115 lands and this script has been run, delete this file.",
];

describe("stale compatibility scripts", () => {
  test("one-off compatibility migration scripts are removed after their cutover", () => {
    for (const script of REMOVED_ONE_OFF_SCRIPTS) expect(existsSync(script), script).toBe(false);
  });

  test("tooling metadata does not keep deleted compatibility scripts alive", () => {
    const knipConfig = readFileSync("knip.jsonc", "utf8");

    for (const script of REMOVED_ONE_OFF_SCRIPTS) expect(knipConfig).not.toContain(script);
  });

  test("remaining scripts do not preserve removed command-layout references", () => {
    for (const script of REMOVED_ONE_OFF_SCRIPTS) {
      if (!existsSync(script)) continue;
      const content = readFileSync(script, "utf8");
      for (const reference of REMOVED_SCRIPT_REFERENCES) expect(content).not.toContain(reference);
    }
  });

});
