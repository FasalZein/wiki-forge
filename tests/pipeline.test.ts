import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { pipelineSteps, PipelineState, runPipeline, type PipelinePhase } from "../src/lib/pipeline";

describe("pipelineSteps", () => {
  it("returns close phase steps in order", () => {
    const steps = pipelineSteps("close");
    expect(steps.map((s) => s.id)).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);
    for (const step of steps) expect(step.phase).toBe("close");
  });

  it("returns verify phase steps in order", () => {
    const steps = pipelineSteps("verify");
    expect(steps.map((s) => s.id)).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);
    for (const step of steps) expect(step.phase).toBe("verify");
  });

  it("returns independent copies each call", () => {
    const a = pipelineSteps("close");
    const b = pipelineSteps("close");
    a.pop();
    expect(b.length).toBe(4);
  });
});

describe("PipelineState", () => {
  let db: Database;
  let state: PipelineState;

  beforeEach(() => {
    db = new Database(":memory:");
    db.run(`CREATE TABLE IF NOT EXISTS pipeline_steps (
      project TEXT NOT NULL,
      slice_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      ok INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      PRIMARY KEY (project, slice_id, step_id)
    )`);
    state = new PipelineState(db);
  });

  afterEach(() => {
    db.close();
  });

  it("record persists step start/end in sqlite", () => {
    state.record("proj", "SLICE-1", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);
    const rows = db.query("SELECT * FROM pipeline_steps WHERE project = 'proj' AND slice_id = 'SLICE-1'").all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].step_id).toBe("checkpoint");
    expect(rows[0].completed_at).toBe("2026-01-01T00:00:01Z");
    expect(rows[0].ok).toBe(1);
    expect(rows[0].error).toBeNull();
  });

  it("record stores error on failure", () => {
    state.record("proj", "SLICE-1", "lint-repo", "2026-01-01T00:00:00Z", "2026-01-01T00:00:02Z", false, "lint failed");
    const rows = db.query("SELECT * FROM pipeline_steps WHERE step_id = 'lint-repo'").all() as Array<Record<string, unknown>>;
    expect(rows[0].ok).toBe(0);
    expect(rows[0].error).toBe("lint failed");
  });

  it("completedSteps returns only finished successful steps", () => {
    state.record("proj", "SLICE-1", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);
    state.record("proj", "SLICE-1", "lint-repo", "2026-01-01T00:00:02Z", null, false, null);
    state.record("proj", "SLICE-1", "maintain", "2026-01-01T00:00:03Z", "2026-01-01T00:00:04Z", false, "failed");
    const completed = state.completedSteps("proj", "SLICE-1");
    expect(completed.length).toBe(1);
    expect(completed[0].stepId).toBe("checkpoint");
  });

  it("shouldSkip returns true for already-completed step", () => {
    state.record("proj", "SLICE-1", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);
    expect(state.shouldSkip("proj", "SLICE-1", "checkpoint")).toBe(true);
  });

  it("shouldSkip returns false for incomplete step", () => {
    state.record("proj", "SLICE-1", "lint-repo", "2026-01-01T00:00:00Z", null, false, null);
    expect(state.shouldSkip("proj", "SLICE-1", "lint-repo")).toBe(false);
  });

  it("shouldSkip returns false for failed step", () => {
    state.record("proj", "SLICE-1", "maintain", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", false, "err");
    expect(state.shouldSkip("proj", "SLICE-1", "maintain")).toBe(false);
  });

  it("shouldSkip returns false for unknown step", () => {
    expect(state.shouldSkip("proj", "SLICE-1", "nonexistent")).toBe(false);
  });

  it("reset clears state for a slice", () => {
    state.record("proj", "SLICE-1", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);
    state.record("proj", "SLICE-1", "lint-repo", "2026-01-01T00:00:02Z", "2026-01-01T00:00:03Z", true, null);
    state.record("proj", "SLICE-2", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);
    state.reset("proj", "SLICE-1");
    expect(state.completedSteps("proj", "SLICE-1").length).toBe(0);
    expect(state.completedSteps("proj", "SLICE-2").length).toBe(1);
  });
});

function makeInMemoryState() {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS pipeline_steps (
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

describe("runPipeline", () => {
  it("dry-run returns steps without executing", async () => {
    const result = await runPipeline({
      project: "test-proj",
      sliceId: "TEST-001",
      phase: "close",
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(result.steps.length).toBe(4);
    for (const step of result.steps) {
      expect(step.skipped).toBe(false);
      expect(step.ok).toBe(true);
      expect(step.durationMs).toBeNull();
    }
    expect(result.steps.map((s) => s.id)).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);
  });

  it("dry-run verify phase returns correct steps", async () => {
    const result = await runPipeline({
      project: "test-proj",
      sliceId: "TEST-001",
      phase: "verify",
      dryRun: true,
    });
    expect(result.steps.map((s) => s.id)).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);
  });

  it("stops on first failure and reports structured error", async () => {
    let callCount = 0;
    const executor = async (command: string, _args: string[]) => {
      callCount++;
      if (command === "lint-repo") return { ok: false, error: "lint issues found" };
      return { ok: true };
    };
    const state = makeInMemoryState();

    const result = await runPipeline(
      { project: "test-proj", sliceId: "TEST-001", phase: "close" },
      executor,
      state,
    );

    expect(result.ok).toBe(false);
    expect(result.stoppedAt).toBe("lint-repo");
    expect(result.steps.length).toBe(2); // checkpoint ok, lint-repo failed, stopped
    expect(result.steps[0].ok).toBe(true);
    expect(result.steps[1].ok).toBe(false);
    expect(result.steps[1].error).toBe("lint issues found");
    expect(callCount).toBe(2); // didn't continue to maintain
  });

  it("executes all steps when all succeed", async () => {
    const executed: string[] = [];
    const executor = async (command: string, _args: string[]) => {
      executed.push(command);
      return { ok: true };
    };
    const state = makeInMemoryState();

    const result = await runPipeline(
      { project: "test-proj", sliceId: "TEST-001", phase: "close" },
      executor,
      state,
    );

    expect(result.ok).toBe(true);
    expect(result.stoppedAt).toBeNull();
    expect(executed).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(result.steps.every((s) => s.durationMs !== null)).toBe(true);
  });

  it("passes repo and base args to executor", async () => {
    const capturedArgs: Array<{ command: string; args: string[] }> = [];
    const executor = async (command: string, args: string[]) => {
      capturedArgs.push({ command, args });
      return { ok: true };
    };
    const state = makeInMemoryState();

    await runPipeline(
      { project: "myproj", sliceId: "SLICE-5", phase: "close", repo: "/some/repo", base: "main" },
      executor,
      state,
    );

    // checkpoint takes project + --repo + --base
    const cpArgs = capturedArgs.find((c) => c.command === "checkpoint")!;
    expect(cpArgs.args).toContain("myproj");
    expect(cpArgs.args).toContain("--repo");
    expect(cpArgs.args).toContain("/some/repo");
    expect(cpArgs.args).toContain("--base");
    expect(cpArgs.args).toContain("main");

    // update-index takes project + --repo + --write but NOT --base
    const uiArgs = capturedArgs.find((c) => c.command === "update-index")!;
    expect(uiArgs.args).toContain("myproj");
    expect(uiArgs.args).toContain("--write");
    expect(uiArgs.args).not.toContain("--base");
  });

  it("verify phase passes slice-id to slice commands", async () => {
    const capturedArgs: Array<{ command: string; args: string[] }> = [];
    const executor = async (command: string, args: string[]) => {
      capturedArgs.push({ command, args });
      return { ok: true };
    };
    const state = makeInMemoryState();

    await runPipeline(
      { project: "myproj", sliceId: "SLICE-5", phase: "verify", repo: "/repo" },
      executor,
      state,
    );

    const vsArgs = capturedArgs.find((c) => c.command === "verify-slice")!;
    expect(vsArgs.args[0]).toBe("myproj");
    expect(vsArgs.args[1]).toBe("SLICE-5");

    const csArgs = capturedArgs.find((c) => c.command === "close-slice")!;
    expect(csArgs.args[0]).toBe("myproj");
    expect(csArgs.args[1]).toBe("SLICE-5");

    // closeout and gate take only project
    const coArgs = capturedArgs.find((c) => c.command === "closeout")!;
    expect(coArgs.args[0]).toBe("myproj");
    expect(coArgs.args).not.toContain("SLICE-5");
  });

  it("skips already-completed steps on re-run", async () => {
    const state = makeInMemoryState();
    // Pre-record checkpoint as completed
    state.record("proj", "S-1", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);

    const executed: string[] = [];
    const executor = async (command: string, _args: string[]) => {
      executed.push(command);
      return { ok: true };
    };

    const result = await runPipeline(
      { project: "proj", sliceId: "S-1", phase: "close" },
      executor,
      state,
    );

    expect(result.ok).toBe(true);
    expect(executed).toEqual(["lint-repo", "maintain", "update-index"]);
    expect(result.steps[0].id).toBe("checkpoint");
    expect(result.steps[0].skipped).toBe(true);
    expect(result.steps[1].skipped).toBe(false);
  });

  it("onStepComplete is called for each executed step with correct fields", async () => {
    const calls: Array<{ id: string; ok: boolean; durationMs: number | null }> = [];
    const executor = async (_command: string, _args: string[]) => ({ ok: true });
    const state = makeInMemoryState();

    await runPipeline(
      {
        project: "proj",
        sliceId: "S-1",
        phase: "close",
        onStepComplete: async (step) => {
          calls.push({ id: step.id, ok: step.ok, durationMs: step.durationMs });
        },
      },
      executor,
      state,
    );

    expect(calls.length).toBe(4);
    expect(calls.map((c) => c.id)).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);
    for (const call of calls) {
      expect(call.ok).toBe(true);
      expect(typeof call.durationMs).toBe("number");
    }
  });

  it("onStepComplete receives failure info when a step fails", async () => {
    const calls: Array<{ id: string; ok: boolean; error: string | null }> = [];
    const executor = async (command: string, _args: string[]) => {
      if (command === "lint-repo") return { ok: false, error: "lint failed" };
      return { ok: true };
    };
    const state = makeInMemoryState();

    await runPipeline(
      {
        project: "proj",
        sliceId: "S-1",
        phase: "close",
        onStepComplete: async (step) => {
          calls.push({ id: step.id, ok: step.ok, error: step.error });
        },
      },
      executor,
      state,
    );

    expect(calls.length).toBe(2);
    expect(calls[0]).toMatchObject({ id: "checkpoint", ok: true, error: null });
    expect(calls[1]).toMatchObject({ id: "lint-repo", ok: false, error: "lint failed" });
  });

  it("onStepComplete is called for skipped steps with ok=true and durationMs=null", async () => {
    const state = makeInMemoryState();
    state.record("proj", "S-1", "checkpoint", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", true, null);

    const calls: Array<{ id: string; ok: boolean; durationMs: number | null }> = [];
    const executor = async (_command: string, _args: string[]) => ({ ok: true });

    await runPipeline(
      {
        project: "proj",
        sliceId: "S-1",
        phase: "close",
        onStepComplete: async (step) => {
          calls.push({ id: step.id, ok: step.ok, durationMs: step.durationMs });
        },
      },
      executor,
      state,
    );

    expect(calls.length).toBe(4);
    expect(calls[0]).toMatchObject({ id: "checkpoint", ok: true, durationMs: null });
    for (const call of calls.slice(1)) {
      expect(call.ok).toBe(true);
      expect(typeof call.durationMs).toBe("number");
    }
  });
});
