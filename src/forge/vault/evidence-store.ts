import matter from "gray-matter";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { forgeSlicePath } from "./forge-paths";
import type { ReviewEvidenceRecord, TddEvidenceRecord, ForgeEvidenceRecord, VerificationEvidenceRecord } from "../lifecycle/evidence";

export type RecordTddEvidenceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly command: string;
  readonly result: "passed" | "failed";
  readonly recordedAt?: string;
  readonly vaultRoot?: string;
};

export type RecordVerificationEvidenceInput = RecordTddEvidenceInput & {
  readonly verificationType: "targeted" | "full-suite";
};

export type RecordReviewEvidenceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly reviewer: string;
  readonly verdict: "approved" | "needs-changes" | "approved-with-followups";
  readonly recordedAt?: string;
  readonly vaultRoot?: string;
};

export async function recordForgeTddEvidence(input: RecordTddEvidenceInput): Promise<TddEvidenceRecord> {
  const record: TddEvidenceRecord = {
    kind: "tdd",
    command: input.command,
    result: input.result,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  await appendForgeEvidence(input.project, input.sliceId, record, input.vaultRoot);
  return record;
}

export async function recordForgeVerificationEvidence(input: RecordVerificationEvidenceInput): Promise<VerificationEvidenceRecord> {
  const record: VerificationEvidenceRecord = {
    kind: "verification",
    verificationType: input.verificationType,
    command: input.command,
    result: input.result,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  await appendForgeEvidence(input.project, input.sliceId, record, input.vaultRoot);
  return record;
}

export async function recordForgeReviewEvidence(input: RecordReviewEvidenceInput): Promise<ReviewEvidenceRecord> {
  const record: ReviewEvidenceRecord = {
    kind: "review",
    reviewer: input.reviewer,
    verdict: input.verdict,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  await appendForgeEvidence(input.project, input.sliceId, record, input.vaultRoot);
  return record;
}

export async function readForgeEvidence(project: string, sliceId: string, vaultRoot = VAULT_ROOT): Promise<readonly ForgeEvidenceRecord[]> {
  const path = sliceIndexPath(vaultRoot, project, sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${project}/${sliceId}`);
  const parsed = matter(await readFile(path, "utf8"));
  return normalizeEvidenceList(parsed.data.forge_evidence);
}

async function appendForgeEvidence(project: string, sliceId: string, record: ForgeEvidenceRecord, vaultRoot = VAULT_ROOT): Promise<void> {
  const path = sliceIndexPath(vaultRoot, project, sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${project}/${sliceId}`);
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  const existing = normalizeEvidenceList(parsed.data.forge_evidence);
  await writeFile(path, matter.stringify(parsed.content, {
    ...parsed.data,
    forge_evidence: [...existing, record],
  }), "utf8");
}

function normalizeEvidenceList(value: unknown): readonly ForgeEvidenceRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => isEvidenceRecord(entry) ? [entry] : []);
}

function isEvidenceRecord(value: unknown): value is ForgeEvidenceRecord {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "tdd" || kind === "verification" || kind === "review" || kind === "closure";
}

function sliceIndexPath(vaultRoot: string, project: string, sliceId: string): string {
  return join(vaultRoot, forgeSlicePath(project, sliceId));
}
