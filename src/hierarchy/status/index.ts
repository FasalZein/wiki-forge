import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { requireValue, safeMatter } from "../../cli-shared";
import { readText } from "../../lib/fs";
import { walkMarkdown } from "../../lib/vault";
import { readVerificationLevel } from "../../lib/verification";
import { projectFeaturesDir, projectPrdsDir, projectSlicesDir } from "../../lib/structure";
import { computeStatus, type HierarchyStatus, type SliceState } from "./compute";

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
  authoredStatus: string | null;
};

type FeatureEntry = {
  featureId: string;
  file: string;
  currentComputedStatus: string | null;
  authoredStatus: string | null;
};

export { computeStatus };
export type { HierarchyStatus, SliceState };

export async function collectFeatureStatuses(project: string): Promise<FeatureStatusRow[]> {
  const featuresDir = projectFeaturesDir(project);
  const prdsDir = projectPrdsDir(project);
  const slicesDir = projectSlicesDir(project);

  const [featureFiles, prdFiles, sliceFiles] = await Promise.all([
    walkMarkdown(featuresDir),
    walkMarkdown(prdsDir),
    walkMarkdown(slicesDir),
  ]);

  const features = new Map<string, FeatureEntry>();
  for (const file of featureFiles) {
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const featureId = typeof parsed.data.feature_id === "string" ? parsed.data.feature_id : null;
    if (!featureId) continue;
    const currentComputedStatus = typeof parsed.data.computed_status === "string" ? parsed.data.computed_status : null;
    const authoredStatus = typeof parsed.data.status === "string" ? parsed.data.status : null;
    features.set(featureId, { featureId, file, currentComputedStatus, authoredStatus });
  }

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
    const authoredStatus = typeof parsed.data.status === "string" ? parsed.data.status : null;
    prds.set(prdId, { prdId, file, parentFeature, currentComputedStatus, authoredStatus });
  }

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

  const prdsByFeature = new Map<string, PrdEntry[]>();
  for (const prd of prds.values()) {
    if (!prd.parentFeature) continue;
    if (!prdsByFeature.has(prd.parentFeature)) prdsByFeature.set(prd.parentFeature, []);
    prdsByFeature.get(prd.parentFeature)!.push(prd);
  }

  const rows: FeatureStatusRow[] = [];
  for (const feature of features.values()) {
    const childPrds = prdsByFeature.get(feature.featureId) ?? [];
    const prdRows: PrdStatusRow[] = childPrds.map((prd) => {
      const prdSlices = slicesByPrd.get(prd.prdId) ?? [];
      return {
        prdId: prd.prdId,
        file: prd.file,
        computedStatus: computeStatus(prdSlices, prd.authoredStatus),
      };
    });
    const featureSlices = slicesByFeature.get(feature.featureId) ?? [];
    const featureStatus = computeStatus(featureSlices, feature.authoredStatus);
    rows.push({ featureId: feature.featureId, file: feature.file, computedStatus: featureStatus, prds: prdRows });
  }

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
