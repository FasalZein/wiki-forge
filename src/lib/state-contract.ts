import type { FrontmatterData } from "../types";

export const STATE_FIELD_AUTHORITIES = ["authored", "computed", "evidence"] as const;
export type StateFieldAuthority = (typeof STATE_FIELD_AUTHORITIES)[number];

export const RECONCILER_SCOPES = ["slice", "project", "history", "protocol"] as const;
export type ReconcilerScope = (typeof RECONCILER_SCOPES)[number];

export type StateContractId =
  | "project-summary"
  | "feature"
  | "prd"
  | "slice-index"
  | "slice-plan"
  | "slice-test-plan"
  | "protocol-surface"
  | "session-handover";

export type StateContract = {
  id: StateContractId;
  scope: ReconcilerScope;
  frontmatter: {
    authored: readonly string[];
    computed: readonly string[];
    evidence: readonly string[];
  };
  writePolicy: {
    frontmatter: readonly string[];
    body: readonly string[];
  };
};

export const RECONCILER_WRITE_SCOPE_CONTRACTS: Record<ReconcilerScope, { frontmatter: readonly string[]; body: readonly string[] }> = {
  slice: {
    frontmatter: ["updated", "verification_level", "previous_level", "stale_since", "verified_against", "computed_status"],
    body: ["generated-links", "generated-verification-summary"],
  },
  project: {
    frontmatter: ["updated", "verification_level", "previous_level", "stale_since", "verified_against", "computed_status"],
    body: ["generated-index-sections", "generated-rollups", "generated-navigation"],
  },
  history: {
    frontmatter: ["updated"],
    body: ["append-only-history"],
  },
  protocol: {
    frontmatter: ["updated", "protocol_version"],
    body: ["managed-protocol-block"],
  },
};

const STATE_CONTRACTS: Record<StateContractId, StateContract> = {
  "project-summary": {
    id: "project-summary",
    scope: "project",
    frontmatter: {
      authored: ["title", "type", "project", "status", "repo", "base", "code_paths", "agents", "protocol_scopes"],
      computed: ["updated", "computed_status"],
      evidence: ["verification_level", "verified_against", "previous_level", "stale_since"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.project,
  },
  feature: {
    id: "feature",
    scope: "project",
    frontmatter: {
      authored: ["title", "type", "spec_kind", "project", "feature_id", "status", "created_at", "started_at", "completed_at", "source_paths"],
      computed: ["updated", "computed_status"],
      evidence: ["verification_level", "verified_against", "previous_level", "stale_since"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.project,
  },
  prd: {
    id: "prd",
    scope: "project",
    frontmatter: {
      authored: ["title", "type", "spec_kind", "project", "prd_id", "parent_feature", "status", "created_at", "started_at", "completed_at", "source_paths"],
      computed: ["updated", "computed_status"],
      evidence: ["verification_level", "verified_against", "previous_level", "stale_since"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.project,
  },
  "slice-index": {
    id: "slice-index",
    scope: "slice",
    frontmatter: {
      authored: ["title", "type", "spec_kind", "project", "task_id", "parent_prd", "parent_feature", "depends_on", "status", "assignee", "source_paths", "created_at", "started_at", "completed_at", "claimed_by", "claimed_at", "claim_paths"],
      computed: ["updated", "computed_status"],
      evidence: ["verification_level", "verified_against", "previous_level", "stale_since"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.slice,
  },
  "slice-plan": {
    id: "slice-plan",
    scope: "slice",
    frontmatter: {
      authored: ["title", "type", "spec_kind", "project", "task_id", "parent_prd", "parent_feature", "assignee", "source_paths", "status", "created_at"],
      computed: ["updated"],
      evidence: ["verification_level", "verified_against", "previous_level", "stale_since"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.slice,
  },
  "slice-test-plan": {
    id: "slice-test-plan",
    scope: "slice",
    frontmatter: {
      authored: ["title", "type", "spec_kind", "project", "task_id", "parent_prd", "parent_feature", "assignee", "source_paths", "status", "created_at"],
      computed: ["updated"],
      evidence: ["verification_level", "verified_against", "verification_commands", "previous_level", "stale_since"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.slice,
  },
  "protocol-surface": {
    id: "protocol-surface",
    scope: "protocol",
    frontmatter: {
      authored: ["project", "scope", "applies_to"],
      computed: ["managed_by", "protocol_version", "updated"],
      evidence: [],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.protocol,
  },
  "session-handover": {
    id: "session-handover",
    scope: "history",
    frontmatter: {
      authored: ["title", "type", "project", "base", "harness", "agent", "status", "created_at"],
      computed: ["updated"],
      evidence: ["verified_against"],
    },
    writePolicy: RECONCILER_WRITE_SCOPE_CONTRACTS.history,
  },
};

export function resolveStateContract(relPath: string, data: FrontmatterData): StateContract | null {
  const normalized = relPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized === "_summary.md" && data.type === "project") return STATE_CONTRACTS["project-summary"];
  if ((normalized === "AGENTS.md" || normalized === "CLAUDE.md") && typeof data.managed_by === "string") return STATE_CONTRACTS["protocol-surface"];
  if (/^handovers\/[^/]+\.md$/u.test(normalized) && data.type === "handover") return STATE_CONTRACTS["session-handover"];
  if (/^specs\/features\/FEAT-\d{3,}-[^/]+\.md$/u.test(normalized) && data.spec_kind === "feature") return STATE_CONTRACTS.feature;
  if (/^specs\/prds\/PRD-\d{3,}-[^/]+\.md$/u.test(normalized) && data.spec_kind === "prd") return STATE_CONTRACTS.prd;
  if (/^specs\/slices\/[^/]+\/index\.md$/u.test(normalized) && data.spec_kind === "task-hub") return STATE_CONTRACTS["slice-index"];
  if (/^specs\/slices\/[^/]+\/plan\.md$/u.test(normalized) && data.spec_kind === "plan") return STATE_CONTRACTS["slice-plan"];
  if (/^specs\/slices\/[^/]+\/test-plan\.md$/u.test(normalized) && data.spec_kind === "test-plan") return STATE_CONTRACTS["slice-test-plan"];
  return null;
}

export function classifyStateField(contract: StateContract, field: string): StateFieldAuthority | null {
  if (contract.frontmatter.authored.includes(field)) return "authored";
  if (contract.frontmatter.computed.includes(field)) return "computed";
  if (contract.frontmatter.evidence.includes(field)) return "evidence";
  return null;
}
