import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { projectTaskHubPath } from "../../lib/structure";

export type PipelineStepProgress = {
  id: string;
  ok: boolean;
  completedAt: string;
  durationMs: number | null;
  error?: string;
};

export type SlicePipelineProgress = {
  steps: PipelineStepProgress[];
  lastStep: string;
  lastStepOk: boolean;
  pipelineOk: boolean;
  lastRunAt: string;
  pipelineState?: "running" | "failed" | "passed";
  nextAction?: string;
  failureSummary?: string;
};

export async function writeSliceProgress(
  project: string,
  sliceId: string,
  progress: SlicePipelineProgress,
): Promise<void> {
  const indexPath = projectTaskHubPath(project, sliceId);
  if (!await exists(indexPath)) return;
  const raw = await readText(indexPath);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), raw);
  if (!parsed) return;
  const data = { ...parsed.data } as Record<string, unknown>;
  data.pipeline_progress = progress.steps.map((step) => ({
    step: step.id,
    ok: step.ok,
    ...(step.durationMs !== null ? { durationMs: step.durationMs } : {}),
    ...(step.error ? { error: step.error } : {}),
  }));
  data.last_forge_run = progress.lastRunAt;
  data.last_forge_step = progress.lastStep;
  data.last_forge_state = progress.pipelineState ?? (progress.pipelineOk ? "passed" : "failed");
  if (progress.pipelineState === "running") delete data.last_forge_ok;
  else data.last_forge_ok = progress.pipelineOk;
  if (progress.nextAction) data.next_action = progress.nextAction;
  else delete data.next_action;
  if (progress.failureSummary) data.failure_summary = progress.failureSummary;
  else delete data.failure_summary;
  data.updated = nowIso();
  writeNormalizedPage(indexPath, parsed.content, orderFrontmatter(data, [
    "title", "type", "spec_kind", "project", "source_paths",
    "assignee", "task_id", "depends_on", "parent_prd", "parent_feature",
    "claimed_by", "claimed_at", "claim_paths",
    "created_at", "updated", "started_at", "completed_at",
    "status", "verification_level",
    "last_forge_run", "last_forge_step", "last_forge_state", "last_forge_ok",
    "next_action", "failure_summary", "pipeline_progress",
  ]));
}

export async function readSliceHandoff(
  project: string,
  sliceId: string,
): Promise<{ lastForgeRun?: string; lastForgeStep?: string; lastForgeState?: string; lastForgeOk?: boolean; nextAction?: string; failureSummary?: string } | null> {
  const indexPath = projectTaskHubPath(project, sliceId);
  if (!await exists(indexPath)) return null;
  const raw = await readText(indexPath);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), raw, { silent: true });
  if (!parsed) return null;
  const d = parsed.data;
  if (!d.last_forge_run) return null;
  return {
    lastForgeRun: typeof d.last_forge_run === "string" ? d.last_forge_run : undefined,
    lastForgeStep: typeof d.last_forge_step === "string" ? d.last_forge_step : undefined,
    lastForgeState: typeof d.last_forge_state === "string" ? d.last_forge_state : undefined,
    lastForgeOk: typeof d.last_forge_ok === "boolean" ? d.last_forge_ok : undefined,
    nextAction: typeof d.next_action === "string" ? d.next_action : undefined,
    failureSummary: typeof d.failure_summary === "string" ? d.failure_summary : undefined,
  };
}

export type PipelineProgressEntry = {
  step: string;
  ok: boolean;
  durationMs?: number;
  error?: string;
};

export async function readSlicePipelineProgress(
  project: string,
  sliceId: string,
): Promise<PipelineProgressEntry[] | null> {
  const indexPath = projectTaskHubPath(project, sliceId);
  if (!await exists(indexPath)) return null;
  const raw = await readText(indexPath);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), raw, { silent: true });
  if (!parsed) return null;
  const rawEntries = parsed.data.pipeline_progress;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null;
  return rawEntries
    .filter((e): e is Record<string, unknown> => e !== null && typeof e === "object")
    .map((e) => ({
      step: typeof e.step === "string" ? e.step : String(e.step ?? ""),
      ok: typeof e.ok === "boolean" ? e.ok : false,
      ...(typeof e.durationMs === "number" ? { durationMs: e.durationMs } : {}),
      ...(typeof e.error === "string" && e.error ? { error: e.error } : {}),
    }));
}
