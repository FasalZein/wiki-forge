import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { fail, nowIso, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { walkMarkdown } from "../../lib/vault";
import { readVerificationLevel } from "../../lib/verification";
import { projectFeaturesDir, projectPrdsDir, projectSlicesDir } from "../../lib/structure";
import { computeStatus, type HierarchyStatus, type SliceState } from "../status/compute";
import { appendLogEntry } from "../../lib/log";
import { collectFeatureStatuses } from "../status";
import type { HierarchyMaintenanceAction } from "./actions";
import { collectSliceDetails, buildLifecycleDriftAction } from "./drift";

async function findEntityFile(project: string, entityId: string, entityType: "feature" | "prd"): Promise<string | null> {
  const dir = entityType === "feature" ? projectFeaturesDir(project) : projectPrdsDir(project);
  if (!await exists(dir)) return null;
  const prefix = entityId.toLowerCase();
  for (const entry of readdirSync(dir)) {
    const lower = entry.toLowerCase();
    if (lower === `${prefix}.md` || lower.startsWith(`${prefix}-`)) {
      return join(dir, entry);
    }
  }
  return null;
}

export async function computeEntityStatus(project: string, entityId: string, entityType: "feature" | "prd"): Promise<HierarchyStatus> {
  let authoredStatus: string | null = null;
  const entityFile = await findEntityFile(project, entityId, entityType);
  if (entityFile) {
    const parsedEntity = safeMatter(relative(VAULT_ROOT, entityFile), await readText(entityFile), { silent: true });
    if (parsedEntity && typeof parsedEntity.data.status === "string") authoredStatus = parsedEntity.data.status;
  }
  const slicesDir = projectSlicesDir(project);
  if (!await exists(slicesDir)) return computeStatus([], authoredStatus);
  const sliceFiles = await walkMarkdown(slicesDir);
  const slices: SliceState[] = [];
  for (const file of sliceFiles) {
    if (!file.endsWith("/index.md")) continue;
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const parentField = entityType === "feature" ? parsed.data.parent_feature : parsed.data.parent_prd;
    if (parentField !== entityId) continue;
    const taskId = typeof parsed.data.task_id === "string" ? parsed.data.task_id : null;
    if (!taskId) continue;
    const status = typeof parsed.data.status === "string" ? parsed.data.status : null;
    const verificationLevel = readVerificationLevel(parsed.data);
    slices.push({ taskId, status, verificationLevel });
  }
  return computeStatus(slices, authoredStatus);
}

export async function lifecycleOpen(project: string, entityId: string, entityType: "feature" | "prd"): Promise<void> {
  const file = await findEntityFile(project, entityId, entityType);
  if (!file) fail(`${entityType} page not found: ${entityId}`);
  const relPath = relative(VAULT_ROOT, file!);
  const raw = await readText(file!);
  const parsed = safeMatter(relPath, raw);
  if (!parsed) fail(`could not parse ${entityType} page: ${entityId}`);
  const currentStatus = typeof parsed!.data.status === "string" ? parsed!.data.status : null;
  if (currentStatus === "in-progress" || currentStatus === "complete") {
    fail(`${entityType} ${entityId} is already ${currentStatus}`);
  }
  const startedAt = nowIso();
  writeNormalizedPage(file!, parsed!.content, { ...parsed!.data, status: "in-progress", started_at: startedAt });
  appendLogEntry(`start-${entityType}`, entityId, { project, details: [`started_at=${startedAt}`] });
}

export async function lifecycleClose(project: string, entityId: string, entityType: "feature" | "prd", force: boolean): Promise<void> {
  const file = await findEntityFile(project, entityId, entityType);
  if (!file) fail(`${entityType} page not found: ${entityId}`);
  const relPath = relative(VAULT_ROOT, file!);
  const raw = await readText(file!);
  const parsed = safeMatter(relPath, raw);
  if (!parsed) fail(`could not parse ${entityType} page: ${entityId}`);
  if (!force) {
    const computedStatus = await computeEntityStatus(project, entityId, entityType);
    if (computedStatus !== "complete") {
      fail(`${entityType} ${entityId} computed status is "${computedStatus}", not complete — use --force to override`);
    }
  }
  const completedAt = nowIso();
  writeNormalizedPage(file!, parsed!.content, { ...parsed!.data, status: "complete", completed_at: completedAt });
  appendLogEntry(`close-${entityType}`, entityId, { project, details: [`completed_at=${completedAt}`, ...(force ? ["force=true"] : [])] });
}


export async function collectLifecycleDriftActions(project: string): Promise<HierarchyMaintenanceAction[]> {
  const [rows, { byPrd, byFeature }] = await Promise.all([
    collectFeatureStatuses(project),
    collectSliceDetails(project),
  ]);
  const actions: HierarchyMaintenanceAction[] = [];
  for (const row of rows) {
    const relPath = relative(VAULT_ROOT, row.file);
    const raw = await readText(row.file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const recordedStatus = typeof parsed.data.status === "string" ? parsed.data.status : null;
    if (recordedStatus === "complete" && row.computedStatus !== "complete") {
      const slices = byFeature.get(row.featureId) ?? [];
      actions.push(buildLifecycleDriftAction("feature", row.featureId, row.file, parsed, slices, project));
    }
    for (const prd of row.prds) {
      const prdRelPath = relative(VAULT_ROOT, prd.file);
      const prdRaw = await readText(prd.file);
      const prdParsed = safeMatter(prdRelPath, prdRaw, { silent: true });
      if (!prdParsed) continue;
      const prdRecordedStatus = typeof prdParsed.data.status === "string" ? prdParsed.data.status : null;
      if (prdRecordedStatus === "complete" && prd.computedStatus !== "complete") {
        const slices = byPrd.get(prd.prdId) ?? [];
        actions.push(buildLifecycleDriftAction("prd", prd.prdId, prd.file, prdParsed, slices, project));
      }
    }
  }
  return actions;
}

export async function collectHierarchyStatusActions(project: string): Promise<HierarchyMaintenanceAction[]> {
  const rows = await collectFeatureStatuses(project);
  const actions: HierarchyMaintenanceAction[] = [];

  for (const row of rows) {
    const file = row.file;
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const current = typeof parsed.data.computed_status === "string" ? parsed.data.computed_status : null;
    if (current !== row.computedStatus) {
      const capturedFile = file;
      const capturedParsed = parsed;
      const capturedStatus = row.computedStatus;
      actions.push({
        kind: "write-frontmatter",
        scope: "parent",
        message: `update computed_status for ${row.featureId}: ${current ?? "(none)"} -> ${capturedStatus}`,
        _apply() {
          writeNormalizedPage(capturedFile, capturedParsed.content, { ...capturedParsed.data, computed_status: capturedStatus });
          appendLogEntry("auto-heal", row.featureId, { project, details: [`rule=R1`, `before=${current ?? "(none)"}`, `after=${capturedStatus}`, `trigger=write-frontmatter`] });
        },
      });
    }

    for (const prd of row.prds) {
      const prdFile = prd.file;
      const prdRelPath = relative(VAULT_ROOT, prdFile);
      const prdRaw = await readText(prdFile);
      const prdParsed = safeMatter(prdRelPath, prdRaw, { silent: true });
      if (!prdParsed) continue;
      const prdCurrent = typeof prdParsed.data.computed_status === "string" ? prdParsed.data.computed_status : null;
      if (prdCurrent !== prd.computedStatus) {
        const capturedPrdFile = prdFile;
        const capturedPrdParsed = prdParsed;
        const capturedPrdStatus = prd.computedStatus;
        actions.push({
          kind: "write-frontmatter",
          scope: "parent",
          message: `update computed_status for ${prd.prdId}: ${prdCurrent ?? "(none)"} -> ${capturedPrdStatus}`,
          _apply() {
            writeNormalizedPage(capturedPrdFile, capturedPrdParsed.content, { ...capturedPrdParsed.data, computed_status: capturedPrdStatus });
            appendLogEntry("auto-heal", prd.prdId, { project, details: [`rule=R1`, `before=${prdCurrent ?? "(none)"}`, `after=${capturedPrdStatus}`, `trigger=write-frontmatter`] });
          },
        });
      }
    }
  }

  return actions;
}
