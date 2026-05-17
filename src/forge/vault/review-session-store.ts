import matter from "gray-matter";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { forgeSlicePath } from "./forge-paths";
import type { ReviewEvidenceRecord } from "../lifecycle/evidence";

export const REVIEW_SESSION_MODES = ["subagent", "human", "automated"] as const;
export type ReviewSessionMode = typeof REVIEW_SESSION_MODES[number];

export type ForgeReviewSessionStatus = "in-review" | "approved" | "needs-changes" | "approved-with-followups";

export type ForgeReviewSession = {
  readonly status: ForgeReviewSessionStatus;
  readonly reviewer: string;
  readonly mode: ReviewSessionMode;
  readonly startedAt: string;
  readonly completedAt?: string;
};

export type StartForgeReviewSessionInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly reviewer: string;
  readonly mode: ReviewSessionMode;
  readonly startedAt?: string;
  readonly vaultRoot?: string;
};

export async function startForgeReviewSession(input: StartForgeReviewSessionInput): Promise<ForgeReviewSession> {
  const session: ForgeReviewSession = {
    status: "in-review",
    reviewer: input.reviewer,
    mode: input.mode,
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
  await updateSliceFrontmatter(input.project, input.sliceId, { forge_review_session: session }, input.vaultRoot);
  return session;
}

export async function completeForgeReviewSession(input: {
  readonly project: string;
  readonly sliceId: string;
  readonly record: ReviewEvidenceRecord;
  readonly vaultRoot?: string;
}): Promise<ForgeReviewSession | null> {
  const path = sliceIndexPath(input.vaultRoot ?? VAULT_ROOT, input.project, input.sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${input.project}/${input.sliceId}`);
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  const current = readOpenReviewSession(parsed.data.forge_review_session);
  if (!current || current.reviewer !== input.record.reviewer) return null;
  const session: ForgeReviewSession = {
    ...current,
    status: input.record.verdict,
    completedAt: input.record.recordedAt,
  };
  await writeFile(path, matter.stringify(parsed.content, { ...parsed.data, forge_review_session: session }), "utf8");
  return session;
}

export function parseReviewSessionMode(value: string | undefined): ReviewSessionMode {
  if (!value) return "subagent";
  if ((REVIEW_SESSION_MODES as readonly string[]).includes(value)) return value as ReviewSessionMode;
  throw new Error(`invalid review session mode: ${value}`);
}

function readOpenReviewSession(value: unknown): ForgeReviewSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.status !== "in-review" || typeof record.reviewer !== "string" || typeof record.mode !== "string" || typeof record.startedAt !== "string") return null;
  const mode = parseReviewSessionMode(record.mode);
  return { status: "in-review", reviewer: record.reviewer, mode, startedAt: record.startedAt };
}

async function updateSliceFrontmatter(project: string, sliceId: string, frontmatter: Record<string, unknown>, vaultRoot = VAULT_ROOT): Promise<void> {
  const path = sliceIndexPath(vaultRoot, project, sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${project}/${sliceId}`);
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  await writeFile(path, matter.stringify(parsed.content, { ...parsed.data, ...frontmatter }), "utf8");
}

function sliceIndexPath(vaultRoot: string, project: string, sliceId: string): string {
  return join(vaultRoot, forgeSlicePath(project, sliceId));
}
