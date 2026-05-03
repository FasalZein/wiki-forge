export type KernelJsonPrimitive = string | number | boolean | null;
export type KernelJsonValue = KernelJsonPrimitive | readonly KernelJsonValue[] | { readonly [key: string]: KernelJsonValue };

export const FIELD_AUTHORITIES = ["authored", "computed", "evidence", "projection"] as const;
export type FieldAuthority = (typeof FIELD_AUTHORITIES)[number];

export const CHANGESET_AUTHORITY_SCOPES = ["wiki-memory", "forge-lifecycle", "kernel-invariant", "projection"] as const;
export type ChangeSetAuthorityScope = (typeof CHANGESET_AUTHORITY_SCOPES)[number];

export const KERNEL_RECORD_KINDS = [
  "feature",
  "prd",
  "slice",
  "active-claim",
  "phase-ledger",
  "evidence",
  "review",
  "amendment",
  "handover",
  "projection",
  "memory",
] as const;
export type KernelRecordKind = (typeof KERNEL_RECORD_KINDS)[number];

export type ChangeTargetRecord = {
  readonly kind: KernelRecordKind;
  readonly project: string;
  readonly id: string;
  readonly path?: string;
};

export type ChangeAffectedFile = {
  readonly path: string;
  readonly authority?: FieldAuthority;
  readonly reason: string;
};

export type ChangeSetAuthority = {
  readonly scope: ChangeSetAuthorityScope;
  readonly fieldAuthority: FieldAuthority;
  readonly actorId: string;
  readonly reason: string;
};

export type ChangeOperationKind = "create-record" | "update-record" | "append-evidence" | "delete-record" | "emit-projection";

export type ChangeField = {
  readonly name: string;
  readonly authority: FieldAuthority;
  readonly value: KernelJsonValue;
};

export type KernelChangeOperation = {
  readonly kind: ChangeOperationKind;
  readonly target: ChangeTargetRecord;
  readonly fields: readonly ChangeField[];
};

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export type AcceptedChangeSet = {
  readonly kind: "accepted-changeset";
  readonly id: string;
  readonly intentId: string;
  readonly createdAt: string;
  readonly authority: ChangeSetAuthority;
  readonly targetRecords: NonEmptyReadonlyArray<ChangeTargetRecord>;
  readonly operations: readonly KernelChangeOperation[];
  readonly affectedFiles: readonly ChangeAffectedFile[];
};

export type ChangeSetDraft = {
  readonly id?: string;
  readonly intentId?: string;
  readonly createdAt?: string;
  readonly authority?: ChangeSetAuthority;
  readonly targetRecords?: readonly ChangeTargetRecord[];
  readonly operations?: readonly KernelChangeOperation[];
  readonly affectedFiles?: readonly ChangeAffectedFile[];
};

export type ChangeSetMissingCommitRequirement = "authority" | "targetRecords";

export type ChangeSetReadiness =
  | { readonly status: "ready" }
  | { readonly status: "not-ready"; readonly missing: readonly ChangeSetMissingCommitRequirement[] };

export function inspectChangeSetReadiness(changeSet: ChangeSetDraft): ChangeSetReadiness {
  const missing: ChangeSetMissingCommitRequirement[] = [];
  if (!changeSet.authority) missing.push("authority");
  if (!changeSet.targetRecords || changeSet.targetRecords.length === 0) missing.push("targetRecords");
  if (missing.length > 0) return { status: "not-ready", missing };
  return { status: "ready" };
}
