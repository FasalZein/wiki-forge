import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVaultWithReadySlice() {
  const vault = tempDir("wiki-v1-next-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", "DEMO-001");
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---\ntitle: DEMO-001 ready slice\ntype: forge-slice\nproject: demo\ntask_id: DEMO-001\nstatus: ready\n---\n# DEMO-001\n`, "utf8");
  writeFileSync(join(vault, "projects", "demo", "backlog.md"), `---\ntype: projection\nproject: demo\n---\n# Legacy backlog\n\n- [ ] DEMO-999 hostile legacy row\n`, "utf8");
  return vault;
}

describe("V1 top-level next", () => {
  test("top-level next routes to V1 forge next instead of legacy session next", () => {
    expect(resolveWikiCommand(["next", "demo"]).command).toBe("next");
  });

  test("returns V1 forge projection and ignores legacy backlog projection", () => {
    const vault = createVaultWithReadySlice();
    const result = runWiki(["next", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });
  });
});
