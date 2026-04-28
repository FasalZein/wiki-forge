import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";
import { shouldUseV1ForgeCheck } from "../../src/slice/forge";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault(evidence: readonly Record<string, unknown>[] = []) {
  const vault = tempDir("wiki-v1-check-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "specs", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  const frontmatter: Record<string, unknown> = {
    title: `${sliceId} test slice`,
    type: "spec",
    spec_kind: "task-hub",
    project: "demo",
    task_id: sliceId,
    status: "in-progress",
    claimed_by: "codex",
    claimed_at: "2026-04-28T05:00:00.000Z",
  };
  if (evidence.length > 0) frontmatter.v1_evidence = evidence;
  writeFileSync(join(sliceDir, "index.md"), matter.stringify(`# ${sliceId}\n`, frontmatter), "utf8");
  return vault;
}

function passingEvidence() {
  return [
    { kind: "tdd", command: "bun test tests/v1/x.test.ts", result: "passed", recordedAt: "2026-04-28T06:00:00.000Z" },
    { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T06:00:01.000Z" },
    { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T06:00:02.000Z" },
  ];
}

function sliceData(vault: string) {
  const raw = readFileSync(join(vault, "projects", "demo", "specs", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data;
}

describe("v1 check command adapter", () => {
  test("resolver and cutover predicate keep implemented check on V1", () => {
    expect(resolveWikiCommand(["v1", "forge", "check", "demo", sliceId, "--json"])).toEqual({
      command: "v1:forge:check",
      args: ["demo", sliceId, "--json"],
    });
    expect(shouldUseV1ForgeCheck(["demo", sliceId, "--json"])).toBe(true);
    expect(shouldUseV1ForgeCheck(["demo", sliceId, "--legacy", "--json"])).toBe(true);
  });

  test("v1 check accepts passing evidence without mutating status", () => {
    const vault = createVault(passingEvidence());
    const result = runWiki(["v1", "forge", "check", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("in-progress");
    expect(sliceData(vault).closed_at).toBeUndefined();
  });

  test("v1 check rejects missing evidence without mutating status", () => {
    const vault = createVault([]);
    const result = runWiki(["v1", "forge", "check", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "rejected",
      rejection: { code: "MissingTddEvidence" },
    });
    expect(sliceData(vault).status).toBe("in-progress");
    expect(sliceData(vault).closed_at).toBeUndefined();
  });

  test("default legacy forge check routes to V1 for simple project/slice path", () => {
    const vault = createVault(passingEvidence());
    const result = runWiki(["forge", "check", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("in-progress");
  });
});
