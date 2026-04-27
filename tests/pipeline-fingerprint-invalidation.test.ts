import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PipelineState } from "../src/lib/pipeline-state";
import { runPipeline } from "../src/slice/pipeline-runner";

function makeInMemoryState() {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE pipeline_steps (
    project TEXT NOT NULL,
    slice_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    ok INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY (project, slice_id, step_id)
  )`);
  return new PipelineState(db);
}

async function makeGitRepo() {
  const repo = join(tmpdir(), `pipeline-fingerprint-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(repo, { recursive: true });
  await Bun.$`git init`.cwd(repo).quiet();
  writeFileSync(join(repo, "tracked.txt"), "initial\n");
  await Bun.$`git add tracked.txt`.cwd(repo).quiet();
  await Bun.$`git -c user.name=test -c user.email=test@example.com commit -qm init`.cwd(repo).quiet();
  return repo;
}

describe("pipeline fingerprint invalidation", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeGitRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("stores the input fingerprint for successful steps when repo context exists", async () => {
    const state = makeInMemoryState();
    const executor = async () => ({ ok: true });

    await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "close", repo },
      executor,
      state,
    );

    const completed = state.completedSteps("proj", "S-1");
    expect(completed).toHaveLength(4);
    expect(completed.every((step) => typeof step.inputFingerprint === "string" && step.inputFingerprint.length > 0)).toBe(true);
  });

  it("reruns previously successful steps after the git fingerprint changes", async () => {
    const state = makeInMemoryState();
    const executedFirst: string[] = [];
    const executorFirst = async (command: string) => {
      executedFirst.push(command);
      return { ok: true };
    };

    await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "verify", repo },
      executorFirst,
      state,
    );
    expect(executedFirst).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);

    writeFileSync(join(repo, "new-change.txt"), "dirty\n");

    const executedSecond: string[] = [];
    const executorSecond = async (command: string) => {
      executedSecond.push(command);
      return { ok: true };
    };

    const rerun = await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "verify", repo },
      executorSecond,
      state,
    );

    expect(executedSecond).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);
    expect(rerun.steps.every((step) => step.skipped === false)).toBe(true);
  });

  it("reruns after a committed clean HEAD change", async () => {
    const state = makeInMemoryState();
    const executedFirst: string[] = [];
    await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "verify", repo },
      async (command: string) => {
        executedFirst.push(command);
        return { ok: true };
      },
      state,
    );
    expect(executedFirst).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);

    writeFileSync(join(repo, "tracked.txt"), "committed change\n");
    await Bun.$`git add tracked.txt`.cwd(repo).quiet();
    await Bun.$`git -c user.name=test -c user.email=test@example.com commit -qm change`.cwd(repo).quiet();

    const executedSecond: string[] = [];
    await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "verify", repo },
      async (command: string) => {
        executedSecond.push(command);
        return { ok: true };
      },
      state,
    );

    expect(executedSecond).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);
  });

  it("reports fingerprint mismatch during dry-run instead of silently skipping", async () => {
    const state = makeInMemoryState();
    state.record("proj", "S-1", "verify-slice", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null, "before");

    writeFileSync(join(repo, "new-change.txt"), "dirty\n");

    const result = await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "verify", repo, dryRun: true },
      undefined,
      state,
    );

    expect(result.steps[0]).toMatchObject({
      id: "verify-slice",
      skipped: false,
      ok: true,
      error: "git fingerprint changed since last successful run",
    });
  });
});
