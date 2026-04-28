import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { evaluateForgeNext } from "../forge/next-intent";
import type { ForgeNextProjection, V1SliceProjectionRecord } from "../forge/status-projection";
import { classifyLegacyDocument, type LegacyClassification } from "./legacy-classifier";
import { parseVaultDocument } from "./frontmatter-codec";

export type RawVaultDocument = {
  readonly path: string;
  readonly markdown: string;
};

export async function loadV1ProjectProjection(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeNextProjection> {
  return projectDocumentsToForgeNext(project, await readProjectSliceDocuments(project, vaultRoot));
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

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}
