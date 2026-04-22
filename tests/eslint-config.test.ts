import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CONFIG_PATH = resolve(REPO_ROOT, "eslint.config.js");

async function newESLint() {
  return new ESLint({ cwd: REPO_ROOT, overrideConfigFile: CONFIG_PATH });
}

describe("WIKI-FORGE-114 eslint config", () => {
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

  test("a synthetic cross-domain import through a public surface passes lint", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { resolveWorkflowSteering } from '../protocol';\nexport const x = resolveWorkflowSteering;\n",
      { filePath: resolve(REPO_ROOT, "src/session/__eslint_synthetic_public_surface_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  test("a synthetic cross-domain import through an approved subdomain entrypoint passes lint", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { collectDirtyRepoStatus } from '../maintenance/shared';\nexport const x = collectDirtyRepoStatus;\n",
      { filePath: resolve(REPO_ROOT, "src/session/__eslint_synthetic_subdomain_surface_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  test("a synthetic slice docs subdomain import through an approved entrypoint passes lint", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { readSliceHub } from '../slice/docs';\nexport const x = readSliceHub;\n",
      { filePath: resolve(REPO_ROOT, "src/session/__eslint_synthetic_slice_docs_surface_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  test("a synthetic slice pipeline subdomain import through an approved entrypoint passes lint", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { writeSliceProgress } from '../slice/pipeline/index';\nexport const x = writeSliceProgress;\n",
      { filePath: resolve(REPO_ROOT, "src/session/__eslint_synthetic_slice_pipeline_surface_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  test("a synthetic protocol source subdomain import through an approved entrypoint passes lint", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { renderPromptProtocolReminders } from '../protocol/source/index';\nexport const x = renderPromptProtocolReminders;\n",
      { filePath: resolve(REPO_ROOT, "src/session/__eslint_synthetic_protocol_source_surface_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  test("a synthetic protocol discovery subdomain import through an approved entrypoint passes lint", async () => {
    const eslint = await newESLint();
    const [result] = await eslint.lintText(
      "import { listCodeFiles } from '../protocol/discovery/index';\nexport const x = listCodeFiles;\n",
      { filePath: resolve(REPO_ROOT, "src/maintenance/__eslint_synthetic_protocol_discovery_surface_import__.ts") },
    );
    const ruleIds = result.messages.map((m) => m.ruleId);
    const hasBoundaryViolation = ruleIds.some((id) => id && id.startsWith("boundaries/"));
    expect(hasBoundaryViolation).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  test("a file over 500 non-blank non-comment lines warns with max-lines", async () => {
    const eslint = await newESLint();
    const body = Array.from({ length: 600 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    const [result] = await eslint.lintText(body + "\n", {
      filePath: resolve(REPO_ROOT, "src/slice/__eslint_synthetic_max_lines__.ts"),
    });
    const ruleIds = result.messages.map((m) => m.ruleId);
    expect(ruleIds).toContain("max-lines");
    expect(result.warningCount).toBeGreaterThan(0);
  });
});
