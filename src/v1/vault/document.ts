import type { VaultPath } from "./path";

export type FrontmatterValue = string | number | boolean | Date | null | readonly FrontmatterValue[] | { readonly [key: string]: FrontmatterValue };
export type FrontmatterMap = { readonly [key: string]: FrontmatterValue | undefined };

export type VaultDocument = {
  readonly path: VaultPath;
  readonly frontmatter: FrontmatterMap;
  readonly body: string;
};

export type V1RecordStatus = "draft" | "ready" | "in-progress" | "done" | "cancelled";

export type ProjectRecord = {
  readonly kind: "project";
  readonly path: VaultPath;
  readonly project: string;
  readonly title: string;
  readonly sourcePaths: readonly string[];
};

export type SliceRecord = {
  readonly kind: "slice";
  readonly path: VaultPath;
  readonly project: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: V1RecordStatus;
  readonly specKind: "task-hub";
  readonly parentPrd?: string;
  readonly parentFeature?: string;
  readonly sourcePaths: readonly string[];
};

export const V1_DIAGNOSTIC_CODES = [
  "MissingRequiredField",
  "InvalidFieldType",
  "ProjectMismatch",
  "UnknownLifecycleShape",
] as const;
export type V1DiagnosticCode = (typeof V1_DIAGNOSTIC_CODES)[number];

export type V1Diagnostic = {
  readonly code: V1DiagnosticCode;
  readonly message: string;
  readonly field?: string;
};

export type RecordDecodeResult<TRecord> =
  | { readonly status: "valid"; readonly record: TRecord }
  | { readonly status: "repairable"; readonly diagnostics: readonly V1Diagnostic[] }
  | { readonly status: "quarantined"; readonly diagnostics: readonly V1Diagnostic[] };
