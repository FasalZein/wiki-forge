import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault(status: "ready" | "in-progress", evidence = false) {
  const vault = tempDir("wiki-mutating-cutover-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  const data: Record<string, unknown> = {
    title: `${sliceId} test slice`,
    type: "forge-slice",
    project: "demo",
    task_id: sliceId,
    status,
  };
  if (status === "in-progress") {
    data.claimed_by = "codex";
    data.claimed_at = "2026-04-28T05:00:00.000Z";
  }
  if (evidence) {
    data.forge_evidence = [
      { kind: "tdd", phase: "red", command: "bun test tests/forge-kernel/x.test.ts", testPaths: ["tests/forge-kernel/x.test.ts"], result: "failed", recordedAt: "2026-04-28T05:59:00.000Z" },
    { kind: "tdd", phase: "green", command: "bun test tests/forge-kernel/x.test.ts", testPaths: ["tests/forge-kernel/x.test.ts"], result: "passed", recordedAt: "2026-04-28T06:00:00.000Z" },
      { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T06:00:01.000Z" },
      { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T06:00:02.000Z" },
    ];
  }
  writeFileSync(join(sliceDir, "index.md"), matter.stringify(`# ${sliceId}\n`, data), "utf8");
  return vault;
}

function sliceData(vault: string) {
  const raw = readFileSync(join(vault, "projects", "demo", "forge", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data;
}

describe("removed mutating Forge cutover", () => {
  test("default wiki forge start routes to Forge", () => {
    const vault = createVault("ready");
    const result = runWiki(["forge", "start", "demo", sliceId, "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("in-progress");
  });

  test("default wiki forge release routes to Forge", () => {
    const vault = createVault("in-progress");
    const result = runWiki(["forge", "release", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({ status: "released", project: "demo", sliceId });
    expect(sliceData(vault).status).toBe("ready");
  });

  test("default project-level wiki forge run starts ready or closes active slices through Forge", () => {
    const readyVault = createVault("ready");
    const readyResult = runWiki(["forge", "run", "demo", "--agent", "codex", "--json"], { vault: readyVault });
    expect(readyResult.exitCode).toBe(0);
    expect(readyResult.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(readyVault).status).toBe("in-progress");

    const activeVault = createVault("in-progress", true);
    const activeResult = runWiki(["forge", "run", "demo", "--agent", "codex", "--json"], { vault: activeVault });
    expect(activeResult.exitCode).toBe(0);
    expect(activeResult.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(activeVault).status).toBe("done");
  });

  test("default wiki forge close and slice-specific run route to Forge close path", () => {
    const closeVault = createVault("in-progress", true);
    const closeResult = runWiki(["forge", "close", "demo", sliceId, "--closed-by", "codex", "--json"], { vault: closeVault });
    expect(closeResult.exitCode).toBe(0);
    expect(closeResult.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(closeVault).status).toBe("done");

    const runVault = createVault("in-progress", true);
    const runResult = runWiki(["forge", "run", "demo", sliceId, "--agent", "codex", "--json"], { vault: runVault });
    expect(runResult.exitCode).toBe(0);
    expect(runResult.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(runVault).status).toBe("done");
  });
});
