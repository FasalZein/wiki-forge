import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveForgeCommand } from "../../src/forge";
import { shouldUseForgeCheck } from "../../src/forge/cutover";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVault(evidence: readonly Record<string, unknown>[] = []) {
  const vault = tempDir("wiki-check-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  const frontmatter: Record<string, unknown> = {
    title: `${sliceId} test slice`,
    type: "forge-slice",
    project: "demo",
    task_id: sliceId,
    status: "in-progress",
    claimed_by: "codex",
    claimed_at: "2026-04-28T05:00:00.000Z",
  };
  if (evidence.length > 0) frontmatter.forge_evidence = evidence;
  writeFileSync(join(sliceDir, "index.md"), matter.stringify(`# ${sliceId}\n`, frontmatter), "utf8");
  return vault;
}

function passingEvidence() {
  return [
    { kind: "tdd", phase: "red", command: "bun test tests/forge-kernel/x.test.ts", testPaths: ["tests/forge-kernel/x.test.ts"], result: "failed", recordedAt: "2026-04-28T05:59:00.000Z" },
    { kind: "tdd", phase: "green", command: "bun test tests/forge-kernel/x.test.ts", testPaths: ["tests/forge-kernel/x.test.ts"], result: "passed", recordedAt: "2026-04-28T06:00:00.000Z" },
    { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T06:00:01.000Z" },
    { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T06:00:02.000Z" },
  ];
}

function sliceData(vault: string) {
  const raw = readFileSync(join(vault, "projects", "demo", "forge", "slices", sliceId, "index.md"), "utf8");
  return matter(raw).data;
}

describe("forge check command adapter", () => {
  test("resolver and cutover predicate keep implemented check on Forge", () => {
    expect(resolveForgeCommand(["check", "demo", sliceId, "--json"])).toEqual({
      command: "forge:check",
      args: ["demo", sliceId, "--json"],
    });
    expect(shouldUseForgeCheck(["demo", sliceId, "--json"])).toBe(true);
    expect(shouldUseForgeCheck(["demo", sliceId, "--legacy", "--json"])).toBe(true);
  });

  test("forge check accepts passing evidence without mutating status", () => {
    const vault = createVault(passingEvidence());
    const result = runWiki(["forge", "check", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("in-progress");
    expect(sliceData(vault).closed_at).toBeUndefined();
  });

  test("forge check rejects missing evidence without mutating status", () => {
    const vault = createVault([]);
    const result = runWiki(["forge", "check", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "rejected",
      rejection: { code: "MissingTddEvidence" },
    });
    expect(sliceData(vault).status).toBe("in-progress");
    expect(sliceData(vault).closed_at).toBeUndefined();
  });

  test("removed check flag routes to Forge for simple project/slice path", () => {
    const vault = createVault(passingEvidence());
    const result = runWiki(["forge", "check", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("in-progress");
  });
});
