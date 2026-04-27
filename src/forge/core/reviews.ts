import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { gitHeadSha } from "../../git-utils";
import { exists, readText } from "../../lib/fs";
import { projectTaskHubPath } from "../../lib/structure";

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

const HUB_FRONTMATTER_ORDER = [
  "title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on",
  "parent_prd", "parent_feature", "claimed_by", "claimed_at", "claim_paths", "created_at", "updated",
  "started_at", "completed_at", "status", "verification_level", "workflow_profile", "review_policy",
  "forge_review_evidence", "forge_workflow_ledger",
];

export function isReviewVerdict(value: string): value is ReviewVerdict {
  return (REVIEW_VERDICTS as readonly string[]).includes(value);
}

export async function recordForgeReview(input: RecordReviewInput): Promise<ForgeReviewEvidence> {
  const indexPath = projectTaskHubPath(input.project, input.sliceId);
  if (!(await exists(indexPath))) throw new Error(`slice index not found: ${input.sliceId}`);
  const matter = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!matter) throw new Error(`could not parse slice index: ${input.sliceId}`);

  const evidence: ForgeReviewEvidence = {
    verdict: input.verdict,
    reviewer: input.reviewer,
    completedAt: nowIso(),
    blockers: input.blockers,
    ...(input.model ? { model: input.model } : {}),
    ...(input.artifact ? { artifact: input.artifact } : {}),
    ...(input.repo ? { git: { head: await gitHeadSha(input.repo) } } : {}),
  };
  const existing = readReviewEvidence(matter.data.forge_review_evidence);
  const nextData = orderFrontmatter(
    { ...matter.data, forge_review_evidence: [...existing, evidence], updated: evidence.completedAt },
    HUB_FRONTMATTER_ORDER,
  );
  writeNormalizedPage(indexPath, matter.content, nextData);
  return evidence;
}

export async function collectReviewGateStatus(project: string, sliceId: string, repo?: string): Promise<ReviewGateStatus> {
  const indexPath = projectTaskHubPath(project, sliceId);
  if (!(await exists(indexPath))) throw new Error(`slice index not found: ${sliceId}`);
  const matter = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!matter) throw new Error(`could not parse slice index: ${sliceId}`);
  const currentHead = repo ? await gitHeadSha(repo) : undefined;
  return reviewGateStatus(matter.data, project, sliceId, currentHead);
}

export function reviewGateStatus(data: Record<string, unknown>, project: string, sliceId: string, currentHead?: string): ReviewGateStatus {
  const requiredApprovals = readRequiredApprovals(data.review_policy);
  const evidence = readReviewEvidence(data.forge_review_evidence);
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
  const numberValue = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function readReviewEvidence(value: unknown): ForgeReviewEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.verdict !== "string" || !isReviewVerdict(record.verdict) || typeof record.reviewer !== "string" || typeof record.completedAt !== "string") return [];
    return [{
      verdict: record.verdict,
      reviewer: record.reviewer,
      completedAt: record.completedAt,
      blockers: Array.isArray(record.blockers) ? record.blockers.filter((blocker): blocker is string => typeof blocker === "string") : [],
      ...(typeof record.model === "string" ? { model: record.model } : {}),
      ...(typeof record.artifact === "string" ? { artifact: record.artifact } : {}),
      ...(record.git && typeof record.git === "object" && typeof (record.git as Record<string, unknown>).head === "string" ? { git: { head: String((record.git as Record<string, unknown>).head) } } : {}),
    }];
  });
}
