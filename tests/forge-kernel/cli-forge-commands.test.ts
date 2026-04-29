import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveForgeCommand } from "../../src/forge";
import { resolveWikiCommand } from "../../src/wiki";
import { projectDocumentsToForgeNext } from "../../src/forge/vault/load-project";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice(status: "ready" | "in-progress" | "done") {
  const vault = tempDir("wiki-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---
title: DEMO-001 first slice
type: forge-slice
project: demo
task_id: DEMO-001
status: ${status}
---
# DEMO-001
`, "utf8");
  return vault;
}

describe("stable CLI command surface", () => {
  test("resolver maps stable forge and wiki commands without public compatibility aliases", () => {
    expect(resolveForgeCommand(["next", "demo"])).toEqual({ command: "forge:next", args: ["demo"] });
    expect(resolveForgeCommand(["status", "demo", "--json"])).toEqual({ command: "forge:status", args: ["demo", "--json"] });
    expect(resolveForgeCommand(["plan", "demo", "feature"])).toEqual({ command: "forge:plan", args: ["demo", "feature"] });
    expect(resolveForgeCommand(["amend", "demo", "DEMO-001", "--reason", "bug"])).toEqual({ command: "forge:amend", args: ["demo", "DEMO-001", "--reason", "bug"] });
    expect(resolveWikiCommand(["forge", "forge", "next", "demo"])).toEqual({ command: "forge", args: ["forge", "next", "demo"] });
  });

  test("project documents adapt to Forge next projection", () => {
    const projection = projectDocumentsToForgeNext("demo", [
      {
        path: "projects/demo/forge/slices/DEMO-001/index.md",
        markdown: `---
title: DEMO-001 first slice
type: forge-slice
project: demo
task_id: DEMO-001
status: ready
---
# DEMO-001
`,
      },
    ]);

    expect(projection).toEqual({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });
  });

  test("wiki forge next renders parseable JSON from the vault", () => {
    const vault = createVaultWithSlice("ready");
    const result = runWiki(["forge", "next", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });
  });

  test("public forge compatibility namespace is removed", () => {
    const vault = createVaultWithSlice("done");
    const result = runWiki(["forge", "compat", "wiki", "forge", "next", "--json"], { vault });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("unknown forge subcommand: compat");
  });
});
