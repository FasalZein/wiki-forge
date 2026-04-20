import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function sliceIndexPath(vault: string, project: string, sliceId: string) {
  return join(vault, "projects", project, "specs", "slices", sliceId, "index.md");
}

function parseFm(filePath: string) {
  return matter(readFileSync(filePath, "utf8"));
}

function callWriteProgress(vault: string, project: string, sliceId: string, progress: Record<string, unknown>) {
  const script = `
    const { writeSliceProgress } = await import("./src/lib/slice-progress");
    await writeSliceProgress(${JSON.stringify(project)}, ${JSON.stringify(sliceId)}, ${JSON.stringify(progress)});
  `;
  const result = Bun.spawnSync(["bun", "-e", script], { cwd: import.meta.dir + "/..", env: { ...process.env, KNOWLEDGE_VAULT_ROOT: vault } });
  if (result.exitCode !== 0) throw new Error(`writeSliceProgress failed: ${result.stderr.toString()}`);
}

function callReadHandoff(vault: string, project: string, sliceId: string): Record<string, unknown> | null {
  const script = `
    const { readSliceHandoff } = await import("./src/lib/slice-progress");
    const result = await readSliceHandoff(${JSON.stringify(project)}, ${JSON.stringify(sliceId)});
    console.log(JSON.stringify(result));
  `;
  const result = Bun.spawnSync(["bun", "-e", script], { cwd: import.meta.dir + "/..", env: { ...process.env, KNOWLEDGE_VAULT_ROOT: vault } });
  if (result.exitCode !== 0) throw new Error(`readSliceHandoff failed: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString().trim());
}

describe("writeSliceProgress", () => {
  test("writes pipeline_progress, last_forge_run, last_forge_step into index.md", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest1"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest1");
    expect(runWiki(["create-issue-slice", "sptest1", "auth slice"], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptest1", "SPTEST1-001", {
      steps: [
        { id: "checkpoint", ok: true, completedAt: "2026-04-18T10:00:00.000Z", durationMs: 120 },
        { id: "lint-repo", ok: false, completedAt: "2026-04-18T10:00:01.000Z", durationMs: 80, error: "lint failed" },
      ],
      lastStep: "lint-repo",
      lastStepOk: false,
      pipelineOk: false,
      lastRunAt: "2026-04-18T10:00:01.000Z",
      nextAction: "fix lint errors",
      failureSummary: "lint-repo failed with: lint failed",
    });

    const parsed = parseFm(sliceIndexPath(vault, "sptest1", "SPTEST1-001"));
    expect(Array.isArray(parsed.data.pipeline_progress)).toBe(true);
    expect(parsed.data.last_forge_run).toBe("2026-04-18T10:00:01.000Z");
    expect(parsed.data.last_forge_step).toBe("lint-repo");
    expect(parsed.data.last_forge_state).toBe("failed");
    expect(parsed.data.last_forge_ok).toBe(false);
    expect(parsed.data.next_action).toBe("fix lint errors");
    expect(parsed.data.failure_summary).toBe("lint-repo failed with: lint failed");
  });

  test("serializes steps using step/ok shape with conditional durationMs and error", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest2"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest2");
    expect(runWiki(["create-issue-slice", "sptest2", "billing slice"], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptest2", "SPTEST2-001", {
      steps: [
        { id: "checkpoint", ok: true, completedAt: "2026-04-18T10:00:00.000Z", durationMs: 100 },
        { id: "gate", ok: false, completedAt: "2026-04-18T10:00:01.000Z", durationMs: null, error: "gate blocked" },
      ],
      lastStep: "gate",
      lastStepOk: false,
      pipelineOk: false,
      lastRunAt: "2026-04-18T10:00:01.000Z",
    });

    const parsed = parseFm(sliceIndexPath(vault, "sptest2", "SPTEST2-001"));
    const steps = parsed.data.pipeline_progress as Array<Record<string, unknown>>;
    expect(steps[0]).toEqual({ step: "checkpoint", ok: true, durationMs: 100 });
    expect(steps[1]).toEqual({ step: "gate", ok: false, error: "gate blocked" });
  });

  test("preserves existing frontmatter fields (status, assignee, task_id)", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest3"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest3");
    expect(runWiki(["create-issue-slice", "sptest3", "payments slice"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "sptest3", "SPTEST3-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptest3", "SPTEST3-001", {
      steps: [{ id: "checkpoint", ok: true, completedAt: "2026-04-18T10:00:00.000Z", durationMs: 50 }],
      lastStep: "checkpoint",
      lastStepOk: true,
      pipelineOk: true,
      lastRunAt: "2026-04-18T10:00:00.000Z",
    });

    const parsed = parseFm(sliceIndexPath(vault, "sptest3", "SPTEST3-001"));
    expect(parsed.data.status).toBe("in-progress");
    expect(parsed.data.task_id).toBe("SPTEST3-001");
    expect(parsed.data.project).toBe("sptest3");
    expect(parsed.data.claimed_by).toBe("codex");
    expect(parsed.data.last_forge_ok).toBe(true);
  });

  test("overwriting progress replaces the previous pipeline_progress", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest4"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest4");
    expect(runWiki(["create-issue-slice", "sptest4", "refund slice"], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptest4", "SPTEST4-001", {
      steps: [{ id: "checkpoint", ok: true, completedAt: "2026-04-18T10:00:00.000Z", durationMs: 10 }],
      lastStep: "checkpoint",
      lastStepOk: true,
      pipelineOk: true,
      lastRunAt: "2026-04-18T09:00:00.000Z",
    });
    callWriteProgress(vault, "sptest4", "SPTEST4-001", {
      steps: [
        { id: "checkpoint", ok: true, completedAt: "2026-04-18T11:00:00.000Z", durationMs: 15 },
        { id: "lint-repo", ok: true, completedAt: "2026-04-18T11:00:01.000Z", durationMs: 20 },
      ],
      lastStep: "lint-repo",
      lastStepOk: true,
      pipelineOk: true,
      lastRunAt: "2026-04-18T11:00:01.000Z",
    });

    const parsed = parseFm(sliceIndexPath(vault, "sptest4", "SPTEST4-001"));
    const steps = parsed.data.pipeline_progress as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps[1].step).toBe("lint-repo");
    expect(parsed.data.last_forge_run).toBe("2026-04-18T11:00:01.000Z");
  });

  test("returns without error when the slice index does not exist", () => {
    const { vault } = setupPassingRepo();
    expect(() => callWriteProgress(vault, "sptest_missing", "SPTEST-MISSING-001", {
      steps: [],
      lastStep: "checkpoint",
      lastStepOk: true,
      pipelineOk: true,
      lastRunAt: "2026-04-18T10:00:00.000Z",
    })).not.toThrow();
  });

  test("running pipeline progress records state without forging a failure result", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptrunning"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptrunning");
    expect(runWiki(["create-issue-slice", "sptrunning", "auth slice"], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptrunning", "SPTRUNNING-001", {
      steps: [{ id: "maintain", ok: true, completedAt: "2026-04-18T10:00:00.000Z", durationMs: 75 }],
      lastStep: "maintain",
      lastStepOk: true,
      pipelineOk: false,
      pipelineState: "running",
      lastRunAt: "2026-04-18T10:00:00.000Z",
      nextAction: "wiki forge run sptrunning SPTRUNNING-001 --repo /repo",
    });

    const parsed = parseFm(sliceIndexPath(vault, "sptrunning", "SPTRUNNING-001"));
    expect(parsed.data.last_forge_state).toBe("running");
    expect(parsed.data.last_forge_ok).toBeUndefined();
    expect(parsed.data.next_action).toBe("wiki forge run sptrunning SPTRUNNING-001 --repo /repo");
    expect(parsed.data.failure_summary).toBeUndefined();
  });
});

describe("readSliceHandoff", () => {
  test("returns null when no progress has been written", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest5"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest5");
    expect(runWiki(["create-issue-slice", "sptest5", "auth slice"], env).exitCode).toBe(0);

    const result = callReadHandoff(vault, "sptest5", "SPTEST5-001");
    expect(result).toBeNull();
  });

  test("returns null when the slice index does not exist", () => {
    const { vault } = setupPassingRepo();
    const result = callReadHandoff(vault, "sptest_missing", "SPTEST-MISSING-001");
    expect(result).toBeNull();
  });

  test("returns handoff data after progress is written", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest6"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest6");
    expect(runWiki(["create-issue-slice", "sptest6", "webhook slice"], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptest6", "SPTEST6-001", {
      steps: [{ id: "checkpoint", ok: true, completedAt: "2026-04-18T12:00:00.000Z", durationMs: 30 }],
      lastStep: "checkpoint",
      lastStepOk: true,
      pipelineOk: true,
      lastRunAt: "2026-04-18T12:00:00.000Z",
      nextAction: "run close pipeline",
    });

    const handoff = callReadHandoff(vault, "sptest6", "SPTEST6-001");
    expect(handoff).not.toBeNull();
    expect(handoff!.lastForgeRun).toBe("2026-04-18T12:00:00.000Z");
    expect(handoff!.lastForgeStep).toBe("checkpoint");
    expect(handoff!.lastForgeState).toBe("passed");
    expect(handoff!.lastForgeOk).toBe(true);
    expect(handoff!.nextAction).toBe("run close pipeline");
    expect(handoff!.failureSummary).toBeUndefined();
  });

  test("returns running handoff state without a false failure boolean", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "sptest7"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "sptest7");
    expect(runWiki(["create-issue-slice", "sptest7", "webhook slice"], env).exitCode).toBe(0);

    callWriteProgress(vault, "sptest7", "SPTEST7-001", {
      steps: [{ id: "update-index", ok: true, completedAt: "2026-04-18T12:00:00.000Z", durationMs: 45 }],
      lastStep: "update-index",
      lastStepOk: true,
      pipelineOk: false,
      pipelineState: "running",
      lastRunAt: "2026-04-18T12:00:00.000Z",
      nextAction: "wiki forge run sptest7 SPTEST7-001 --repo /repo",
    });

    const handoff = callReadHandoff(vault, "sptest7", "SPTEST7-001");
    expect(handoff).not.toBeNull();
    expect(handoff!.lastForgeState).toBe("running");
    expect(handoff!.lastForgeOk).toBeUndefined();
    expect(handoff!.nextAction).toContain("wiki forge run sptest7 SPTEST7-001");
  });
});
