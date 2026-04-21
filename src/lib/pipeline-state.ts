import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_ROOT } from "../constants";

export interface StepRecord {
  stepId: string;
  startedAt: string;
  completedAt: string | null;
  ok: boolean;
  error: string | null;
};

function dbPath() {
  return join(VAULT_ROOT, ".cache", "wiki-cli", "pipeline.db");
}

function ensureDb(): Database {
  const path = dbPath();
  const dir = join(path, "..");
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
    return rows.map((row) => ({
      stepId: row.step_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      ok: row.ok === 1,
      error: row.error,
    }));
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
