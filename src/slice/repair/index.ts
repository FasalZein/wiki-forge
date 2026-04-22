import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { readVerificationLevel } from "../../lib/verification";
import { collectBacklog } from "../../hierarchy";
import { sliceDocPaths } from "../docs";

type DoneSliceRepair = {
  project: string;
  repaired: Array<{ taskId: string; completedAt: string; files: string[]; changes: string[] }>;
  alreadyCurrent: number;
  missingDocs: string[];
  archiveCandidates: Array<{ taskId: string; completedAt: string; ageDays: number }>;
};

export async function repairHistoricalDoneSlices(project: string): Promise<DoneSliceRepair> {
  const backlog = await collectBacklog(project);
  const repairedAt = nowIso();
  const repaired: DoneSliceRepair["repaired"] = [];
  const missingDocs: string[] = [];
  const archiveCandidates: DoneSliceRepair["archiveCandidates"] = [];
  let alreadyCurrent = 0;

  for (const item of backlog.sections["Done"] ?? []) {
    const docs = await readDoneSliceDocs(project, item.id);
    if (!docs.length) {
      missingDocs.push(item.id);
      continue;
    }
    const completedAt = inferHistoricalCompletedAt(docs);
    const changes = collectDoneSliceRepairChanges(docs);
    const archiveCandidate = classifyArchiveCandidate(item.id, completedAt);
    if (archiveCandidate) archiveCandidates.push(archiveCandidate);
    if (!changes.length) {
      alreadyCurrent += 1;
      continue;
    }
    for (const doc of docs) {
      const normalized = normalizeDoneSliceDoc(doc, completedAt, repairedAt);
      writeNormalizedPage(doc.path, doc.content, normalized);
    }
    repaired.push({
      taskId: item.id,
      completedAt,
      files: docs.map((doc) => relative(VAULT_ROOT, doc.path)),
      changes,
    });
    appendLogEntry("repair-done-slice", item.id, {
      project,
      details: [`completed_at=${completedAt}`, `changes=${changes.length}`],
    });
  }

  return { project, repaired, alreadyCurrent, missingDocs, archiveCandidates };
}

async function readDoneSliceDocs(project: string, taskId: string) {
  const paths = sliceDocPaths(project, taskId);
  const docs: Array<{ path: string; content: string; data: Record<string, unknown>; kind: "index" | "plan" | "test-plan" }> = [];
  for (const [kind, path] of [
    ["index", paths.indexPath],
    ["plan", paths.planPath],
    ["test-plan", paths.testPlanPath],
  ] as const) {
    if (!await exists(path)) continue;
    const raw = await readText(path);
    const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
    if (!parsed) continue;
    docs.push({ path, content: parsed.content, data: parsed.data, kind });
  }
  return docs;
}

function inferHistoricalCompletedAt(docs: Array<{ data: Record<string, unknown> }>) {
  for (const key of ["completed_at", "updated", "started_at", "created_at"] as const) {
    const timestamps = docs.flatMap((doc) => [doc.data[key]])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));
    if (timestamps.length) return new Date(Math.max(...timestamps)).toISOString();
  }
  return nowIso();
}

function collectDoneSliceRepairChanges(docs: Array<{ data: Record<string, unknown>; kind: "index" | "plan" | "test-plan" }>) {
  const changes = new Set<string>();
  for (const doc of docs) {
    if (doc.data.status !== "done") changes.add("set status: done");
    if (typeof doc.data.completed_at !== "string" || !doc.data.completed_at.trim()) changes.add("set completed_at");
    if (doc.data.claimed_by || doc.data.claimed_at || doc.data.claim_paths) changes.add("clear claim metadata");
    if (!readVerificationLevel(doc.data)) {
      changes.add(doc.kind === "test-plan" ? "set verification_level: test-verified" : "set verification_level: code-verified");
    }
  }
  return [...changes];
}

function normalizeDoneSliceDoc(
  doc: { data: Record<string, unknown>; kind: "index" | "plan" | "test-plan" },
  completedAt: string,
  repairedAt: string,
) {
  const next = { ...doc.data } as Record<string, unknown>;
  next.status = "done";
  next.completed_at = typeof next.completed_at === "string" && next.completed_at.trim() ? next.completed_at : completedAt;
  next.updated = repairedAt;
  if (!readVerificationLevel(next)) next.verification_level = doc.kind === "test-plan" ? "test-verified" : "code-verified";
  delete next.claimed_by;
  delete next.claimed_at;
  delete next.claim_paths;
  return orderFrontmatter(next, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "started_at", "updated", "completed_at", "status", "verification_level"]);
}

function classifyArchiveCandidate(taskId: string, completedAt: string) {
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs)) return null;
  const ageDays = Math.floor((Date.now() - completedMs) / (1000 * 60 * 60 * 24));
  if (ageDays < 30) return null;
  return { taskId, completedAt, ageDays };
}
