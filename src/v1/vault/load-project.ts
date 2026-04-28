import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { evaluateForgeNext } from "../forge/next-intent";
import { projectSliceToStatus, type ForgeNextProjection, type V1SliceProjectionRecord, type V1SliceStatusProjection } from "../forge/status-projection";
import { classifyLegacyDocument, type LegacyClassification } from "./legacy-classifier";
import { parseVaultDocument } from "./frontmatter-codec";
import { readV1Evidence } from "./evidence-store";

export type RawVaultDocument = {
  readonly path: string;
  readonly markdown: string;
};

export async function loadV1ProjectProjection(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeNextProjection> {
  return projectDocumentsToForgeNext(project, await readProjectSliceDocuments(project, vaultRoot));
}

export async function loadV1SliceStatus(project: string, sliceId: string, vaultRoot = VAULT_ROOT): Promise<V1SliceStatusProjection> {
  const document = await readProjectSliceDocument(project, sliceId, vaultRoot);
  if (!document) {
    return {
      status: "missing",
      project,
      sliceId,
      source: "canonical-records",
      diagnostics: [`canonical slice hub not found: ${project}/${sliceId}`],
    };
  }
  const vaultDocument = parseVaultDocument(document.path, document.markdown);
  const classification = classifyLegacyDocument(vaultDocument);
  if (classification.status === "projection") {
    return {
      status: "needs-repair",
      project,
      sliceId,
      source: "canonical-records",
      diagnostics: [{ code: "UnknownLifecycleShape", message: classification.reason }],
    };
  }
  if (classification.status !== "valid") {
    return {
      status: "needs-repair",
      project,
      sliceId,
      source: "canonical-records",
      diagnostics: classification.diagnostics,
    };
  }
  if (classification.record.kind !== "slice") {
    return {
      status: "needs-repair",
      project,
      sliceId,
      source: "canonical-records",
      diagnostics: [{ code: "UnknownLifecycleShape", message: "canonical document is not a slice record" }],
    };
  }
  return projectSliceToStatus({
    project,
    sliceId,
    record: classification.record,
    frontmatter: {
      claimedBy: readString(vaultDocument.frontmatter.claimed_by),
      claimedAt: readString(vaultDocument.frontmatter.claimed_at),
      closedBy: readString(vaultDocument.frontmatter.closed_by),
      closedAt: readString(vaultDocument.frontmatter.closed_at),
    },
    evidence: await readV1Evidence(project, sliceId, vaultRoot),
  });
}

export async function readProjectSliceDocuments(project: string, vaultRoot = VAULT_ROOT): Promise<readonly RawVaultDocument[]> {
  const slicesRoot = join(vaultRoot, "projects", project, "specs", "slices");
  if (!existsSync(slicesRoot)) return [];
  const entries = await readdir(slicesRoot, { withFileTypes: true });
  const documents: RawVaultDocument[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = join(slicesRoot, entry.name, "index.md");
    if (!existsSync(indexPath)) continue;
    documents.push({
      path: normalizeVaultPath(relative(vaultRoot, indexPath)),
      markdown: await readFile(indexPath, "utf8"),
    });
  }
  return documents.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readProjectSliceDocument(project: string, sliceId: string, vaultRoot = VAULT_ROOT): Promise<RawVaultDocument | null> {
  const indexPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "index.md");
  if (!existsSync(indexPath)) return null;
  return {
    path: normalizeVaultPath(relative(vaultRoot, indexPath)),
    markdown: await readFile(indexPath, "utf8"),
  };
}

export function projectDocumentsToForgeNext(project: string, documents: readonly RawVaultDocument[]): ForgeNextProjection {
  const classifications = documents.map((document) => classifyLegacyDocument(parseVaultDocument(document.path, document.markdown)));
  return evaluateForgeNext({
    project,
    slices: classifications.flatMap(sliceProjectionRecord),
    legacyClassifications: classifications,
  });
}

function sliceProjectionRecord(classification: LegacyClassification): readonly V1SliceProjectionRecord[] {
  if (classification.status !== "valid" || classification.record.kind !== "slice") return [];
  return [{
    project: classification.record.project,
    taskId: classification.record.taskId,
    title: classification.record.title,
    status: classification.record.status,
  }];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}
