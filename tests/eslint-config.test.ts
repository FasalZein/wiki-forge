import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CONFIG_PATH = resolve(REPO_ROOT, "eslint.config.js");

async function newESLint() {
  return new ESLint({ cwd: REPO_ROOT, overrideConfigFile: CONFIG_PATH });
}

describe("WIKI-FORGE-114 eslint config", () => {
  test("eslint.config.js exists and declares the three required rules", async () => {
    const source = await readFile(CONFIG_PATH, "utf8");
    expect(source).toContain("max-lines");
    expect(source).toContain("no-restricted-syntax");
    expect(source).toContain("ExportAllDeclaration");
    expect(source).toContain("boundaries");
  });

  test("a synthetic export * fails lint with no-restricted-syntax", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "export * from './nowhere';\n",
      { filePath: resolve(REPO_ROOT, "src/slice/__eslint_synthetic_export_star__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    expect(ruleIds).toContain("no-restricted-syntax");
    expect(result.errorCount).toBeGreaterThan(0);
  });

  test("a synthetic cross-domain deep import fails lint with boundaries", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { foo } from '../maintenance/_shared';\nexport const x = foo;\n",
      { filePath: resolve(REPO_ROOT, "src/slice/__eslint_synthetic_deep_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(true);
    expect(result.errorCount).toBeGreaterThan(0);
  });
});
