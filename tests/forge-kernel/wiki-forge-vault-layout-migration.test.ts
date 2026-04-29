import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

describe("wiki-forge vault layout migration", () => {
  test("update-index does not recreate specs indexes after a project migrates to Forge layout", () => {
    const vault = tempDir("wiki-layout-migration-vault");
    initVault(vault);
    const projectRoot = join(vault, "projects", "demo");
    mkdirSync(join(projectRoot, "forge", "slices", "DEMO-Forge-001"), { recursive: true });
    writeFileSync(join(projectRoot, "backlog.md"), "# Backlog\n\n## In Progress\n", "utf8");
    writeFileSync(join(projectRoot, "_summary.md"), "---\ntitle: demo\nstatus: active\n---\n# Demo\n", "utf8");
    writeFileSync(join(projectRoot, "forge", "slices", "DEMO-Forge-001", "index.md"), `---
title: DEMO-Forge-001 active slice
type: forge-slice
project: demo
task_id: DEMO-Forge-001
status: in-progress
---
# DEMO-Forge-001
`, "utf8");

    const result = runWiki(["update-index", "demo", "--write", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    const targetPaths = result.json().targets.map((target: { path: string }) => target.path);
    expect(targetPaths).toContain("index.md");
    expect(targetPaths).toContain("projects/_dashboard.md");
    expect(targetPaths).not.toContain("projects/demo/specs/index.md");
    expect(targetPaths).not.toContain("projects/demo/specs/slices/index.md");
  });
});
