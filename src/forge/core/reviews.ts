import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { safeMatter } from "../../cli-shared";
import { gitHeadSha } from "../../git-utils";
import { exists, readText } from "../../lib/fs";
import { forgeSlicePath } from "../vault/forge-paths";
import { readForgeEvidence, recordForgeReviewEvidence } from "../vault/evidence-store";
import type { ReviewEvidenceRecord } from "../lifecycle/evidence";

export const REVIEW_VERDICTS = ["approved", "needs_changes", "approved_with_followups"] as const;
export type ReviewVerdict = typeof REVIEW_VERDICTS[number];

export type ForgeReviewEvidence = {
  verdict: ReviewVerdict;
  reviewer: string;
  completedAt: string;
  blockers: string[];
  model?: string;
  artifact?: string;
  git?: { head: string };
};

export type ReviewGateStatus = {
  status: "not-required" | "pending" | "passed" | "blocked";
  requiredApprovals: number;
  approvals: number;
  blockers: string[];
  evidence: ForgeReviewEvidence[];
  missingReviewers: string[];
  availableReviewers: string[];
  repair?: string;
};

export type RecordReviewInput = {
  project: string;
  sliceId: string;
  verdict: ReviewVerdict;
  reviewer: string;
  model?: string;
  artifact?: string;
  blockers: string[];
  repo?: string;
};

export function isReviewVerdict(value: string): value is ReviewVerdict {
  return (REVIEW_VERDICTS as readonly string[]).includes(value);
}

export async function recordForgeReview(input: RecordReviewInput): Promise<ForgeReviewEvidence> {
  const head = input.repo ? await gitHeadSha(input.repo) : undefined;
  const recorded = await recordForgeReviewEvidence({
    project: input.project,
    sliceId: input.sliceId,
    reviewer: input.reviewer,
    verdict: toEvidenceVerdict(input.verdict),
    ...(head ? { git: { head } } : {}),
  });
  return toGateEvidence(recorded);
}

export async function collectReviewGateStatus(project: string, sliceId: string, repo?: string): Promise<ReviewGateStatus> {
  const indexPath = forgeSliceIndexPath(project, sliceId);
  if (!(await exists(indexPath))) throw new Error(`slice index not found: ${sliceId}`);
  const matter = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!matter) throw new Error(`could not parse slice index: ${sliceId}`);
  const evidence = await readForgeEvidence(project, sliceId);
  const currentHead = repo ? await gitHeadSha(repo) : undefined;
  return reviewGateStatus({ ...matter.data, forge_evidence: evidence }, project, sliceId, currentHead);
}

export function reviewGateStatus(data: Record<string, unknown>, project: string, sliceId: string, currentHead?: string): ReviewGateStatus {
  const requiredApprovals = readRequiredApprovals(data.review_policy);
  const evidence = readReviewEvidence(data.forge_evidence);
  const relevantEvidence = currentHead ? evidence.filter((entry) => !entry.git || entry.git.head === currentHead) : evidence;
  const staleEvidence = currentHead ? evidence.filter((entry) => entry.git && entry.git.head !== currentHead) : [];
  const approvals = relevantEvidence.filter((entry) => entry.verdict === "approved" || entry.verdict === "approved_with_followups").length;
  const blockers = relevantEvidence.filter((entry) => entry.verdict === "needs_changes").flatMap((entry) => entry.blockers.length ? entry.blockers : [`${entry.reviewer} requested changes`]);
  const staleSummary = staleEvidence.length ? [`${staleEvidence.length} review record(s) target an older git revision`] : [];
  const base = { requiredApprovals, approvals, blockers: [...blockers, ...staleSummary], evidence, missingReviewers: [], availableReviewers: [...new Set(relevantEvidence.map((entry) => entry.reviewer))].sort() };
  if (requiredApprovals <= 0) return { ...base, status: "not-required" };
  const repair = `wiki forge review record ${project} ${sliceId} --verdict approved --reviewer <name>`;
  if (base.blockers.length > 0) return { ...base, status: "blocked", repair };
  if (approvals < requiredApprovals) return { ...base, status: "pending", repair };
  return { ...base, status: "passed" };
}

function readRequiredApprovals(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const raw = (value as Record<string, unknown>).required_approvals;
  let numberValue = 0;
  if (typeof raw === "number") {
    numberValue = raw;
  } else if (typeof raw === "string") {
    numberValue = Number.parseInt(raw, 10);
  }
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function readReviewEvidence(value: unknown): ForgeReviewEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (record.kind !== "review" || typeof record.verdict !== "string" || typeof record.reviewer !== "string" || typeof record.recordedAt !== "string") return [];
    const verdict = toReviewVerdict(record.verdict);
    if (!verdict) return [];
    return [toGateEvidence({
      kind: "review",
      verdict: toEvidenceVerdict(verdict),
      reviewer: record.reviewer,
      recordedAt: record.recordedAt,
      ...(record.git && typeof record.git === "object" && typeof (record.git as Record<string, unknown>).head === "string"
        ? { git: { head: String((record.git as Record<string, unknown>).head) } }
        : {}),
    })];
  });
}

function toReviewVerdict(value: string): ReviewVerdict | null {
  const normalized = value.replaceAll("-", "_");
  return isReviewVerdict(normalized) ? normalized : null;
}

function toEvidenceVerdict(value: ReviewVerdict): ReviewEvidenceRecord["verdict"] {
  return value.replaceAll("_", "-") as ReviewEvidenceRecord["verdict"];
}

function toGateEvidence(record: ReviewEvidenceRecord): ForgeReviewEvidence {
  return {
    verdict: toReviewVerdict(record.verdict) ?? "needs_changes",
    reviewer: record.reviewer,
    completedAt: record.recordedAt,
    blockers: [],
    ...(record.git ? { git: record.git } : {}),
  };
}

function forgeSliceIndexPath(project: string, sliceId: string): string {
  return join(VAULT_ROOT, forgeSlicePath(project, sliceId));
}
