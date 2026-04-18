import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_ROOT } from "../constants";

export type PipelinePhase = "close" | "verify";

export interface PipelineStepDef {
  id: string;
  label: string;
  phase: PipelinePhase;
  /** The wiki CLI command to run (args are appended by the runner). */
  command: string;
  /** Extra fixed args appended after the project/slice args. */
  extraArgs?: string[];
}

export interface StepRecord {
  stepId: string;
  startedAt: string;
  completedAt: string | null;
  ok: boolean;
  error: string | null;
}

export interface PipelineResult {
  project: string;
  sliceId: string;
  phase: PipelinePhase;
  steps: Array<{
    id: string;
    label: string;
    skipped: boolean;
    ok: boolean;
    error: string | null;
    durationMs: number | null;
  }>;
  ok: boolean;
  stoppedAt: string | null;
}

const CLOSE_STEPS: PipelineStepDef[] = [
  { id: "checkpoint", label: "checkpoint", phase: "close", command: "checkpoint" },
  { id: "lint-repo", label: "lint-repo", phase: "close", command: "lint-repo" },
  { id: "maintain", label: "maintain", phase: "close", command: "maintain" },
  { id: "update-index", label: "update-index", phase: "close", command: "update-index", extraArgs: ["--write"] },
];

const VERIFY_STEPS: PipelineStepDef[] = [
  { id: "verify-slice", label: "verify-slice", phase: "verify", command: "verify-slice" },
  { id: "closeout", label: "closeout", phase: "verify", command: "closeout" },
  { id: "gate", label: "gate", phase: "verify", command: "gate" },
  { id: "close-slice", label: "close-slice", phase: "verify", command: "close-slice" },
];

export function pipelineSteps(phase: PipelinePhase): PipelineStepDef[] {
  return phase === "close" ? [...CLOSE_STEPS] : [...VERIFY_STEPS];
}

// --- SQLite state ---

function dbPath() {
  return join(VAULT_ROOT, ".cache", "wiki-cli", "pipeline.db");
}

function ensureDb(): Database {
  const path = dbPath();
  const dir = join(path, "..");
  // Sync exception: Database constructor requires synchronous setup
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
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
  return db;
}

export class PipelineState {
  private db: Database;

  constructor(db?: Database) {
    this.db = db ?? ensureDb();
  }

  record(project: string, sliceId: string, stepId: string, startedAt: string, completedAt: string | null, ok: boolean, error: string | null) {
    this.db.run(
      `INSERT OR REPLACE INTO pipeline_steps (project, slice_id, step_id, started_at, completed_at, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [project, sliceId, stepId, startedAt, completedAt, ok ? 1 : 0, error],
    );
  }

  completedSteps(project: string, sliceId: string): StepRecord[] {
    const rows = this.db.query(
      `SELECT step_id, started_at, completed_at, ok, error FROM pipeline_steps
       WHERE project = ? AND slice_id = ? AND completed_at IS NOT NULL AND ok = 1
       ORDER BY started_at`,
    ).all(project, sliceId) as Array<{ step_id: string; started_at: string; completed_at: string; ok: number; error: string | null }>;
    return rows.map((r) => ({ stepId: r.step_id, startedAt: r.started_at, completedAt: r.completed_at, ok: r.ok === 1, error: r.error }));
  }

  shouldSkip(project: string, sliceId: string, stepId: string): boolean {
    const row = this.db.query(
      `SELECT ok FROM pipeline_steps WHERE project = ? AND slice_id = ? AND step_id = ? AND completed_at IS NOT NULL AND ok = 1`,
    ).get(project, sliceId, stepId) as { ok: number } | null;
    return row !== null;
  }

  reset(project: string, sliceId: string) {
    this.db.run(`DELETE FROM pipeline_steps WHERE project = ? AND slice_id = ?`, [project, sliceId]);
  }

  resetStep(project: string, sliceId: string, stepId: string) {
    this.db.run(`DELETE FROM pipeline_steps WHERE project = ? AND slice_id = ? AND step_id = ?`, [project, sliceId, stepId]);
  }

  close() {
    this.db.close();
  }
}

// --- Runner ---

export interface RunPipelineOptions {
  project: string;
  sliceId: string;
  phase: PipelinePhase;
  repo?: string;
  base?: string;
  dryRun?: boolean;
  json?: boolean;
  worktree?: boolean;
  sliceLocal?: boolean;
}

export async function runPipeline(options: RunPipelineOptions, executor?: (command: string, args: string[]) => Promise<{ ok: boolean; error?: string }>, injectedState?: PipelineState): Promise<PipelineResult> {
  const steps = pipelineSteps(options.phase);
  const ownsState = !injectedState;
  const state = injectedState ?? new PipelineState();
  const result: PipelineResult = {
    project: options.project,
    sliceId: options.sliceId,
    phase: options.phase,
    steps: [],
    ok: true,
    stoppedAt: null,
  };

  try {
    for (const step of steps) {
      const skipped = !options.dryRun && state.shouldSkip(options.project, options.sliceId, step.id);
      if (skipped) {
        result.steps.push({ id: step.id, label: step.label, skipped: true, ok: true, error: null, durationMs: null });
        continue;
      }

      if (options.dryRun) {
        result.steps.push({ id: step.id, label: step.label, skipped: false, ok: true, error: null, durationMs: null });
        continue;
      }

      const args = buildStepArgs(step, options);
      const startedAt = new Date().toISOString();
      state.record(options.project, options.sliceId, step.id, startedAt, null, false, null);

      const run = executor
        ? await executor(step.command, args)
        : await executeStep(step.command, args);

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      state.record(options.project, options.sliceId, step.id, startedAt, completedAt, run.ok, run.error ?? null);

      result.steps.push({ id: step.id, label: step.label, skipped: false, ok: run.ok, error: run.error ?? null, durationMs });

      if (!run.ok) {
        result.ok = false;
        result.stoppedAt = step.id;
        break;
      }
    }
  } finally {
    if (ownsState) state.close();
  }

  return result;
}

function buildStepArgs(step: PipelineStepDef, options: RunPipelineOptions): string[] {
  const args: string[] = [];

  // Commands that take project + slice-id as positional args
  const sliceCommands = new Set(["verify-slice", "close-slice"]);
  // Commands that take only project as positional arg
  const projectCommands = new Set(["checkpoint", "lint-repo", "maintain", "closeout", "gate", "update-index"]);

  if (sliceCommands.has(step.command)) {
    args.push(options.project, options.sliceId);
  } else if (projectCommands.has(step.command)) {
    args.push(options.project);
  }

  if (options.repo) args.push("--repo", options.repo);
  if (options.base && !["update-index"].includes(step.command)) args.push("--base", options.base);
  if (options.worktree) args.push("--worktree");
  if (options.sliceLocal && ["checkpoint", "closeout", "gate", "close-slice"].includes(step.command)) {
    args.push("--slice-local");
    if (step.command !== "close-slice") args.push("--slice-id", options.sliceId);
  }
  if (step.extraArgs) args.push(...step.extraArgs);

  return args;
}

async function executeStep(command: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  const wikiPath = process.argv[1];
  const proc = await Bun.$`${process.argv[0]} ${wikiPath} ${command} ${args}`.nothrow().quiet().env({ ...process.env });
  if (proc.exitCode === 0) return { ok: true };
  const stderr = proc.stderr.toString().trim();
  return { ok: false, error: stderr || `exit code ${proc.exitCode}` };
}
