import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

function createVaultWithEvidence(evidence: readonly Record<string, unknown>[]) {
  const vault = tempDir("wiki-v1-close-vault");
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

describe("v1 close/run command adapters", () => {
  test("resolver maps v1 close and run", () => {
    expect(resolveWikiCommand(["v1", "forge", "close", "demo", sliceId, "--closed-by", "codex"])).toEqual({
      command: "v1:forge:close",
      args: ["demo", sliceId, "--closed-by", "codex"],
    });
    expect(resolveWikiCommand(["v1", "forge", "run", "demo", sliceId])).toEqual({
      command: "v1:forge:run",
      args: ["demo", sliceId],
    });
  });

  test("v1 close rejects missing evidence and does not mutate the slice", () => {
    const vault = createVaultWithEvidence([]);
    const before = readFileSync(join(vault, "projects", "demo", "specs", "slices", sliceId, "index.md"), "utf8");
    const result = runWiki(["v1", "forge", "close", "demo", sliceId, "--closed-by", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "rejected",
      rejection: { code: "MissingTddEvidence" },
    });
    const after = readFileSync(join(vault, "projects", "demo", "specs", "slices", sliceId, "index.md"), "utf8");
    expect(after).toBe(before);
  });

  test("v1 close accepts passing evidence and records closure fields", () => {
    const vault = createVaultWithEvidence(passingEvidence());
    const result = runWiki(["v1", "forge", "close", "demo", sliceId, "--closed-by", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    const data = sliceData(vault);
    expect(data.status).toBe("done");
    expect(data.closed_by).toBe("codex");
    expect(data.closed_at).toBeString();
    expect(data.claimed_by).toBeUndefined();
    expect(data.claimed_at).toBeUndefined();
    expect(data.v1_evidence).toHaveLength(3);
    expect(data.v1_closure_evidence).toEqual(["tdd", "verification", "review"]);
  });

  test("v1 run uses close path for a fully verified active slice", () => {
    const vault = createVaultWithEvidence(passingEvidence());
    const result = runWiki(["v1", "forge", "run", "demo", sliceId, "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    expect(sliceData(vault).status).toBe("done");
  });
});
