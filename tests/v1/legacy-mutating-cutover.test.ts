import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { shouldUseV1ForgeClose, shouldUseV1ForgeRelease, shouldUseV1ForgeRun, shouldUseV1ForgeStart } from "../../src/slice/forge";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault(status: "ready" | "in-progress", evidence = false) {
  const vault = tempDir("wiki-v1-mutating-cutover-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "specs", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  const data: Record<string, unknown> = {
    title: `${sliceId} test slice`,
    type: "spec",
    spec_kind: "task-hub",
    project: "demo",
    task_id: sliceId,
    status,
  };
  if (status === "in-progress") {
    data.claimed_by = "codex";
    data.claimed_at = "2026-04-28T05:00:00.000Z";
  }
  if (evidence) {
    data.v1_evidence = [
      { kind: "tdd", command: "bun test tests/v1/x.test.ts", result: "passed", recordedAt: "2026-04-28T06:00:00.000Z" },
      { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T06:00:01.000Z" },
      { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T06:00:02.000Z" },
    ];
  }
  writeFileSync(join(sliceDir, "index.md"), matter.stringify(`# ${sliceId}\n`, data), "utf8");
  return vault;
}

function sliceData(vault: string) {
  const raw = readFileSync(join(vault, "projects", "demo", "specs", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data;
}

describe("legacy mutating forge V1 cutover", () => {
  test("helper predicates keep unsupported forms on legacy", () => {
    expect(shouldUseV1ForgeStart(["demo", sliceId, "--json"])).toBe(true);
    expect(shouldUseV1ForgeStart(["demo", sliceId, "--legacy", "--json"])).toBe(false);
    expect(shouldUseV1ForgeRelease(["demo", sliceId])).toBe(true);
    expect(shouldUseV1ForgeClose(["demo", sliceId, "--json"])).toBe(true);
    expect(shouldUseV1ForgeRun(["demo", sliceId, "--json"])).toBe(true);
    expect(shouldUseV1ForgeRun(["demo", "--json"])).toBe(false);
    expect(shouldUseV1ForgeRun(["demo", sliceId, "--legacy", "--json"])).toBe(false);
  });

  test("default wiki forge start routes to V1", () => {
    const vault = createVault("ready");
    const result = runWiki(["forge", "start", "demo", sliceId, "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("in-progress");
  });

  test("default wiki forge release routes to V1", () => {
    const vault = createVault("in-progress");
    const result = runWiki(["forge", "release", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({ status: "released", project: "demo", sliceId });
    expect(sliceData(vault).status).toBe("ready");
  });

  test("default wiki forge close and slice-specific run route to V1 close path", () => {
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
