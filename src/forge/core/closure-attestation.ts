import { formatGitTruthSummary, type GitTruth } from "./git-truth";
import type { SliceOwnershipMap } from "./ownership-map";
import type { DiagnosticFinding } from "../../maintenance/shared";

export const CLOSURE_ATTESTATION_STATUSES = ["pass", "warning", "pending", "blocked", "not-required"] as const;

export type ClosureAttestationStatus = typeof CLOSURE_ATTESTATION_STATUSES[number];

export type ClosureAttestationCheck = {
  status: ClosureAttestationStatus;
  label: string;
  summary: string;
  files?: string[];
};

export type ClosureAttestation = {
  wikiFreshness: ClosureAttestationCheck;
  git: ClosureAttestationCheck;
  ownership: ClosureAttestationCheck;
  verification: ClosureAttestationCheck;
  review: ClosureAttestationCheck;
  ledgerWorkflow: ClosureAttestationCheck;
  overall: ClosureAttestationCheck;
};

export type ClosureAttestationExternalStatus = {
  status: ClosureAttestationStatus;
  summary?: string;
};

export type ClosureAttestationInput = {
  findings?: DiagnosticFinding[];
  staleImpactedPages?: Array<{ wikiPage: string }>;
  gitTruth?: GitTruth;
  ownership?: SliceOwnershipMap | null;
  workflowValidation?: { ok: boolean; errors?: string[]; warnings?: string[] } | null;
  verification?: ClosureAttestationExternalStatus | null;
  review?: ClosureAttestationExternalStatus | null;
};

export function collectClosureAttestation(input: ClosureAttestationInput): ClosureAttestation {
  const findings = input.findings ?? [];
  const staleImpactedPages = input.staleImpactedPages ?? [];
  const hardFreshnessFindings = findings.filter((finding) => isHardFinding(finding) && finding.message.includes("stale"));
  const softFreshnessFindings = findings.filter((finding) => !isHardFinding(finding) && finding.message.includes("stale"));
  const wikiFreshness = hardFreshnessFindings.length > 0
    ? check("blocked", "Wiki freshness", `${hardFreshnessFindings.length} hard freshness blocker(s)`)
    : staleImpactedPages.length > 0 || softFreshnessFindings.length > 0
      ? check("warning", "Wiki freshness", `${Math.max(staleImpactedPages.length, softFreshnessFindings.length)} stale or drifted page(s) reported`)
      : check("pass", "Wiki freshness", "No stale impacted pages reported");

  const git = input.gitTruth
    ? input.gitTruth.clean
      ? check("pass", "Git worktree", "Git worktree is clean")
      : check("blocked", "Git worktree", `Git worktree is dirty: ${formatGitTruthSummary(input.gitTruth)}`, input.gitTruth.changedFiles)
    : check("not-required", "Git worktree", "Git truth was not collected");

  const unownedFiles = input.ownership?.entries.filter((entry) => entry.kind === "unowned").map((entry) => entry.file) ?? [];
  const ownership = input.ownership
    ? unownedFiles.length > 0
      ? check("blocked", "Ownership", `${unownedFiles.length} changed file(s) are unowned`, unownedFiles)
      : check("pass", "Ownership", "Changed files are owned or ignored")
    : check("not-required", "Ownership", "Ownership map was not collected");

  const verification = externalCheck("Verification", input.verification);
  const review = externalCheck("Review", input.review);

  const ledgerWorkflow = input.workflowValidation
    ? input.workflowValidation.ok
      ? check(input.workflowValidation.warnings?.length ? "warning" : "pass", "Ledger/workflow", input.workflowValidation.warnings?.length ? `${input.workflowValidation.warnings.length} workflow warning(s)` : "Workflow validation passed")
      : check("blocked", "Ledger/workflow", input.workflowValidation.errors?.length ? `${input.workflowValidation.errors.length} workflow error(s)` : "Workflow validation failed")
    : check("not-required", "Ledger/workflow", "Workflow validation was not provided");

  const parts = [wikiFreshness, git, ownership, verification, review, ledgerWorkflow];
  const overallStatus = summarizeOverall(parts.map((part) => part.status));
  return {
    wikiFreshness,
    git,
    ownership,
    verification,
    review,
    ledgerWorkflow,
    overall: check(overallStatus, "Overall close readiness", overallSummary(overallStatus)),
  };
}

function isHardFinding(finding: DiagnosticFinding) {
  return finding.blockingSeverity === "hard" || finding.severity === "blocker";
}

function externalCheck(label: string, value?: ClosureAttestationExternalStatus | null): ClosureAttestationCheck {
  if (!value) return check("not-required", label, `${label} status was not provided`);
  return check(value.status, label, value.summary ?? `${label} status is ${value.status}`);
}

function summarizeOverall(statuses: ClosureAttestationStatus[]): ClosureAttestationStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("warning")) return "warning";
  return "pass";
}

function overallSummary(status: ClosureAttestationStatus) {
  if (status === "blocked") return "Close readiness is blocked";
  if (status === "pending") return "Close readiness is pending required evidence";
  if (status === "warning") return "Close readiness has warnings";
  return "Close readiness passed";
}

function check(status: ClosureAttestationStatus, label: string, summary: string, files?: string[]): ClosureAttestationCheck {
  return {
    status,
    label,
    summary,
    ...(files && files.length > 0 ? { files: [...files].sort() } : {}),
  };
}
