import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { evaluateForgeNext } from "../lifecycle/next-intent";
import { projectSliceToStatus, type ForgeNextProjection, type SliceProjectionRecord, type SliceStatusProjection } from "../workflow/status-projection";
import { parseVaultDocument } from "./frontmatter-codec";
import { readForgeEvidence } from "./evidence-store";
import { decodeForgeRecord, type ForgeRecord } from "./records";
import { forgeSlicePath, forgeProjectDir } from "./forge-paths";
import type { SliceRecord } from "./document";

export type RawVaultDocument = {
  readonly path: string;
  readonly markdown: string;
};

export async function loadForgeProjectProjection(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeNextProjection> {
  return projectDocumentsToForgeNext(project, await readProjectSliceDocuments(project, vaultRoot));
}

export async function loadForgeSliceStatus(project: string, sliceId: string, vaultRoot = VAULT_ROOT): Promise<SliceStatusProjection> {
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
  const decoded = decodeForgeRecord(vaultDocument);
  if (decoded.status !== "valid") {
    return {
      status: "needs-repair",
      project,
      sliceId,
      source: "canonical-records",
      diagnostics: decoded.diagnostics,
    };
  }
  if (decoded.record.kind !== "slice") {
    return {
      status: "needs-repair",
      project,
      sliceId,
      source: "canonical-records",
      diagnostics: [{ code: "UnknownLifecycleShape", message: "canonical document is not a Forge slice record" }],
    };
  }
  return projectSliceToStatus({
    project,
    sliceId,
    record: toSliceRecord(decoded.record),
    frontmatter: {
      claimedBy: readString(vaultDocument.frontmatter.claimed_by),
      claimedAt: readString(vaultDocument.frontmatter.claimed_at),
      closedBy: readString(vaultDocument.frontmatter.closed_by),
      closedAt: readString(vaultDocument.frontmatter.closed_at),
    },
    evidence: await readForgeEvidence(project, sliceId, vaultRoot),
  });
}

export async function readProjectSliceDocuments(project: string, vaultRoot = VAULT_ROOT): Promise<readonly RawVaultDocument[]> {
  const slicesRoot = join(vaultRoot, `${forgeProjectDir(project)}/slices`);
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
  const indexPath = join(vaultRoot, forgeSlicePath(project, sliceId));
  if (!existsSync(indexPath)) return null;
  return {
    path: normalizeVaultPath(relative(vaultRoot, indexPath)),
    markdown: await readFile(indexPath, "utf8"),
  };
}

export function projectDocumentsToForgeNext(project: string, documents: readonly RawVaultDocument[]): ForgeNextProjection {
  const decoded = documents.map((document) => decodeForgeRecord(parseVaultDocument(document.path, document.markdown)));
  return evaluateForgeNext({
    project,
    slices: decoded.flatMap(sliceProjectionRecord),
    legacyClassifications: [],
  });
}

function sliceProjectionRecord(decoded: ReturnType<typeof decodeForgeRecord>): readonly SliceProjectionRecord[] {
  if (decoded.status !== "valid" || decoded.record.kind !== "slice") return [];
  return [{
    project: decoded.record.project,
    taskId: decoded.record.taskId,
    title: decoded.record.title,
    status: decoded.record.status,
  }];
}

function toSliceRecord(record: Extract<ForgeRecord, { readonly kind: "slice" }>): SliceRecord {
  return {
    kind: "slice",
    path: record.path,
    project: record.project,
    taskId: record.taskId,
    title: record.title,
    status: record.status,
    specKind: "task-hub",
    parentPrd: record.parentPrd,
    parentFeature: record.parentFeature,
    sourcePaths: record.sourcePaths,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}
