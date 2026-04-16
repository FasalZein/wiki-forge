import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { fail, nowIso, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { walkMarkdown } from "../lib/vault";
import { readVerificationLevel } from "../lib/verification";
import { projectFeaturesDir, projectPrdsDir, projectSlicesDir } from "../lib/structure";
import { computeStatus, type HierarchyStatus, type SliceState } from "../lib/hierarchy";
import { appendLogEntry } from "../lib/log";

export type FeatureStatusRow = {
  featureId: string;
  file: string;
  computedStatus: HierarchyStatus;
  prds: PrdStatusRow[];
};

export type PrdStatusRow = {
  prdId: string;
  file: string;
  computedStatus: HierarchyStatus;
};

type SliceEntry = {
  taskId: string;
  parentPrd: string | null;
  parentFeature: string | null;
  status: string | null;
  verificationLevel: string | null;
};

type PrdEntry = {
  prdId: string;
  file: string;
  parentFeature: string | null;
  currentComputedStatus: string | null;
};

type FeatureEntry = {
  featureId: string;
  file: string;
  currentComputedStatus: string | null;
};

export async function collectFeatureStatuses(project: string): Promise<FeatureStatusRow[]> {
  const featuresDir = projectFeaturesDir(project);
  const prdsDir = projectPrdsDir(project);
  const slicesDir = projectSlicesDir(project);

  const [featureFiles, prdFiles, sliceFiles] = await Promise.all([
    walkMarkdown(featuresDir),
    walkMarkdown(prdsDir),
    walkMarkdown(slicesDir),
  ]);

  // Parse feature pages
  const features = new Map<string, FeatureEntry>();
  for (const file of featureFiles) {
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const featureId = typeof parsed.data.feature_id === "string" ? parsed.data.feature_id : null;
    if (!featureId) continue;
    const currentComputedStatus = typeof parsed.data.computed_status === "string" ? parsed.data.computed_status : null;
    features.set(featureId, { featureId, file, currentComputedStatus });
  }

  // Parse PRD pages
  const prds = new Map<string, PrdEntry>();
  for (const file of prdFiles) {
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const prdId = typeof parsed.data.prd_id === "string" ? parsed.data.prd_id : null;
    if (!prdId) continue;
    const parentFeature = typeof parsed.data.parent_feature === "string" ? parsed.data.parent_feature : null;
    const currentComputedStatus = typeof parsed.data.computed_status === "string" ? parsed.data.computed_status : null;
    prds.set(prdId, { prdId, file, parentFeature, currentComputedStatus });
  }

  // Parse slice index pages (index.md only)
  const slices: SliceEntry[] = [];
  for (const file of sliceFiles) {
    if (!file.endsWith("/index.md")) continue;
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const taskId = typeof parsed.data.task_id === "string" ? parsed.data.task_id : null;
    if (!taskId) continue;
    const parentPrd = typeof parsed.data.parent_prd === "string" ? parsed.data.parent_prd : null;
    const parentFeature = typeof parsed.data.parent_feature === "string" ? parsed.data.parent_feature : null;
    const status = typeof parsed.data.status === "string" ? parsed.data.status : null;
    const verificationLevel = readVerificationLevel(parsed.data);
    slices.push({ taskId, parentPrd, parentFeature, status, verificationLevel });
  }

  // Group slices by parent PRD
  const slicesByPrd = new Map<string, SliceState[]>();
  const slicesByFeature = new Map<string, SliceState[]>();
  for (const slice of slices) {
    if (slice.parentPrd) {
      if (!slicesByPrd.has(slice.parentPrd)) slicesByPrd.set(slice.parentPrd, []);
      slicesByPrd.get(slice.parentPrd)!.push({ taskId: slice.taskId, status: slice.status, verificationLevel: slice.verificationLevel });
    }
    if (slice.parentFeature) {
      if (!slicesByFeature.has(slice.parentFeature)) slicesByFeature.set(slice.parentFeature, []);
      slicesByFeature.get(slice.parentFeature)!.push({ taskId: slice.taskId, status: slice.status, verificationLevel: slice.verificationLevel });
    }
  }

  // Group PRDs by parent feature
  const prdsByFeature = new Map<string, PrdEntry[]>();
  for (const prd of prds.values()) {
    if (!prd.parentFeature) continue;
    if (!prdsByFeature.has(prd.parentFeature)) prdsByFeature.set(prd.parentFeature, []);
    prdsByFeature.get(prd.parentFeature)!.push(prd);
  }

  // Build result
  const rows: FeatureStatusRow[] = [];
  for (const feature of features.values()) {
    const childPrds = prdsByFeature.get(feature.featureId) ?? [];

    // Compute PRD-level statuses
    const prdRows: PrdStatusRow[] = childPrds.map((prd) => {
      const prdSlices = slicesByPrd.get(prd.prdId) ?? [];
      return {
        prdId: prd.prdId,
        file: prd.file,
        computedStatus: computeStatus(prdSlices),
      };
    });

    // Feature status: aggregate from all slices that have this feature as parent
    const featureSlices = slicesByFeature.get(feature.featureId) ?? [];
    const featureStatus = computeStatus(featureSlices);

    rows.push({ featureId: feature.featureId, file: feature.file, computedStatus: featureStatus, prds: prdRows });
  }

  // Sort by featureId
  rows.sort((a, b) => a.featureId.localeCompare(b.featureId));
  return rows;
}

export async function featureStatusCommand(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const json = args.includes("--json");

  const rows = await collectFeatureStatuses(project);

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(`no features found for ${project}`);
    return;
  }

  // Print table
  const featColWidth = Math.max(10, ...rows.map((r) => r.featureId.length));
  const statusColWidth = Math.max(16, ...rows.flatMap((r) => [r.computedStatus.length, ...r.prds.map((p) => p.computedStatus.length)]));

  const header = `${"Feature/PRD".padEnd(featColWidth)}  ${"Status".padEnd(statusColWidth)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const row of rows) {
    console.log(`${row.featureId.padEnd(featColWidth)}  ${row.computedStatus.padEnd(statusColWidth)}`);
    for (const prd of row.prds) {
      const indent = "  ";
      console.log(`${(indent + prd.prdId).padEnd(featColWidth)}  ${prd.computedStatus.padEnd(statusColWidth)}`);
    }
  }
}

// ─── Lifecycle: shared helpers ───────────────────────────────────────────────

/**
 * Find a feature or PRD file by scanning the appropriate directory for files
 * whose name starts with `<entityId>-` (case-insensitive) or equals `<entityId>.md`.
 */
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

/**
 * Compute the hierarchy status for a single feature or PRD by looking at its child slices.
 * For features we look at slices with parent_feature=entityId; for PRDs parent_prd=entityId.
 */
async function computeEntityStatus(project: string, entityId: string, entityType: "feature" | "prd"): Promise<HierarchyStatus> {
  const slicesDir = projectSlicesDir(project);
  if (!await exists(slicesDir)) return "not-started";
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
  return computeStatus(slices);
}

/**
 * Open a feature or PRD lifecycle: set status=in-progress and started_at.
 * Errors if the file is not found or already in-progress/complete.
 */
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

/**
 * Close a feature or PRD lifecycle: set status=complete and completed_at.
 * Gates on computed status = complete unless force=true.
 */
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

// ─── start-feature / close-feature ───────────────────────────────────────────

export async function startFeature(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "feature-id");
  await lifecycleOpen(project, entityId, "feature");
  console.log(`started feature ${entityId}`);
}

export async function closeFeature(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "feature-id");
  await lifecycleClose(project, entityId, "feature", force);
  console.log(`closed feature ${entityId}${force ? " (forced)" : ""}`);
}

// ─── start-prd / close-prd ───────────────────────────────────────────────────

export async function startPrd(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "prd-id");
  await lifecycleOpen(project, entityId, "prd");
  console.log(`started prd ${entityId}`);
}

export async function closePrd(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "prd-id");
  await lifecycleClose(project, entityId, "prd", force);
  console.log(`closed prd ${entityId}${force ? " (forced)" : ""}`);
}

/**
 * Collect drift actions for feature/PRD pages whose `status` field is `complete`
 * but whose computed status (from child slices) is not `complete`.
 * Used by collectMaintenancePlan to surface premature close-outs.
 */
export async function collectLifecycleDriftActions(project: string): Promise<Array<{ kind: string; message: string }>> {
  const rows = await collectFeatureStatuses(project);
  const actions: Array<{ kind: string; message: string }> = [];
  for (const row of rows) {
    const relPath = relative(VAULT_ROOT, row.file);
    const raw = await readText(row.file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const recordedStatus = typeof parsed.data.status === "string" ? parsed.data.status : null;
    if (recordedStatus === "complete" && row.computedStatus !== "complete") {
      actions.push({
        kind: "lifecycle-drift",
        message: `feature ${row.featureId} status=complete but computed=${row.computedStatus} — reopen or re-verify slices`,
      });
    }
    for (const prd of row.prds) {
      const prdRelPath = relative(VAULT_ROOT, prd.file);
      const prdRaw = await readText(prd.file);
      const prdParsed = safeMatter(prdRelPath, prdRaw, { silent: true });
      if (!prdParsed) continue;
      const prdRecordedStatus = typeof prdParsed.data.status === "string" ? prdParsed.data.status : null;
      if (prdRecordedStatus === "complete" && prd.computedStatus !== "complete") {
        actions.push({
          kind: "lifecycle-drift",
          message: `prd ${prd.prdId} status=complete but computed=${prd.computedStatus} — reopen or re-verify slices`,
        });
      }
    }
  }
  return actions;
}

/**
 * Collect `write-frontmatter` actions for feature/PRD pages whose computed_status
 * differs from the freshly computed value. Used by collectMaintenancePlan.
 */
export async function collectHierarchyStatusActions(project: string): Promise<Array<{ kind: string; message: string; _apply?: () => void }>> {
  const rows = await collectFeatureStatuses(project);
  const actions: Array<{ kind: string; message: string; _apply?: () => void }> = [];

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
        message: `update computed_status for ${row.featureId}: ${current ?? "(none)"} -> ${capturedStatus}`,
        _apply() {
          writeNormalizedPage(capturedFile, capturedParsed.content, { ...capturedParsed.data, computed_status: capturedStatus });
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
          message: `update computed_status for ${prd.prdId}: ${prdCurrent ?? "(none)"} -> ${capturedPrdStatus}`,
          _apply() {
            writeNormalizedPage(capturedPrdFile, capturedPrdParsed.content, { ...capturedPrdParsed.data, computed_status: capturedPrdStatus });
          },
        });
      }
    }
  }

  return actions;
}
