import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";
import { projectDocumentsToForgeNext } from "../../src/v1/vault/load-project";

afterEach(() => cleanupTempPaths());

function createVaultWithSlice(status: "ready" | "in-progress" | "done") {
  const vault = tempDir("wiki-v1-vault");
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

describe("v1 CLI command surface", () => {
  test("resolver maps wiki v1 forge and compat commands without changing legacy forge routing", () => {
    expect(resolveWikiCommand(["v1", "forge", "next", "demo"])).toEqual({
      command: "v1:forge:next",
      args: ["demo"],
    });
    expect(resolveWikiCommand(["v1", "forge", "status", "demo", "--json"])).toEqual({
      command: "v1:forge:status",
      args: ["demo", "--json"],
    });
    expect(resolveWikiCommand(["v1", "forge", "plan", "demo", "feature"])).toEqual({
      command: "v1:forge:plan",
      args: ["demo", "feature"],
    });
    expect(resolveWikiCommand(["v1", "forge", "amend", "demo", "DEMO-001", "--reason", "bug"])).toEqual({
      command: "v1:forge:amend",
      args: ["demo", "DEMO-001", "--reason", "bug"],
    });
    expect(resolveWikiCommand(["v1", "compat", "wiki", "forge", "next"])).toEqual({
      command: "v1:compat",
      args: ["wiki", "forge", "next"],
    });
    expect(resolveWikiCommand(["forge", "next", "demo"])).toEqual({
      command: "forge",
      args: ["next", "demo"],
    });
  });

  test("project documents adapt to V1 forge next projection", () => {
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
    const result = runWiki(["v1", "forge", "next", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });
  });

  test("wiki v1 compat reports V1 ownership for implemented commands", () => {
    const vault = createVaultWithSlice("done");
    const result = runWiki(["v1", "compat", "wiki", "forge", "next", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      command: "wiki forge next",
      status: "v1-owned",
      replacement: "wiki forge next",
      reason: "Forge-owned command; no legacy fallback",
    });
  });
});
