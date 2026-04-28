import type { V1HandoverRecord } from "../handover/schema";
import type { FrontmatterValue, RecordDecodeResult, V1Diagnostic, V1RecordStatus, VaultDocument } from "./document";
import { isV1ForgeEvidencePath, isV1ForgeFeaturePath, isV1ForgeHandoverPath, isV1ForgePath, isV1ForgePrdPath, isV1ForgeSlicePath } from "./forge-paths";
import type { VaultPath } from "./path";
import { inferProjectFromPath } from "./path";

export type V1ForgeRecord = V1FeatureRecord | V1PrdRecord | V1SliceWorkflowRecord | V1EvidencePageRecord | V1HandoverRecord;

export type V1FeatureRecord = {
  readonly kind: "feature";
  readonly path: VaultPath;
  readonly title: string;
  readonly project: string;
  readonly featureId: string;
  readonly status: V1RecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly prdIds: readonly string[];
  readonly planningSession?: string;
  readonly sourcePaths: readonly string[];
};

export type V1PrdRecord = {
  readonly kind: "prd";
  readonly path: VaultPath;
  readonly title: string;
  readonly project: string;
  readonly prdId: string;
  readonly parentFeature: string;
  readonly status: V1RecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sliceIds: readonly string[];
  readonly planningSession?: string;
};

export type V1SliceWorkflowRecord = {
  readonly kind: "slice";
  readonly path: VaultPath;
  readonly title: string;
  readonly project: string;
  readonly taskId: string;
  readonly parentFeature: string;
  readonly parentPrd: string;
  readonly status: V1RecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly planningSession?: string;
  readonly sourcePaths: readonly string[];
};

export type V1EvidencePageRecord = {
  readonly kind: "evidence";
  readonly path: VaultPath;
  readonly title: string;
  readonly project: string;
  readonly taskId: string;
  readonly status: V1RecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly records: readonly FrontmatterValue[];
};

const VALID_RECORD_STATUSES = ["draft", "ready", "in-progress", "done", "cancelled"] as const satisfies readonly V1RecordStatus[];

export function decodeV1ForgeRecord(document: VaultDocument): RecordDecodeResult<V1ForgeRecord> {
  if (!isV1ForgePath(document.path)) return quarantine("document path is outside V1 forge/** layout");
  const type = readString(document.frontmatter.type);
  if (type === "forge-feature" && isV1ForgeFeaturePath(document.path)) return decodeFeatureRecord(document);
  if (type === "forge-prd" && isV1ForgePrdPath(document.path)) return decodePrdRecord(document);
  if (type === "forge-slice" && isV1ForgeSlicePath(document.path)) return decodeSliceWorkflowRecord(document);
  if (type === "forge-evidence" && isV1ForgeEvidencePath(document.path)) return decodeEvidencePageRecord(document);
  if (type === "forge-handover" && isV1ForgeHandoverPath(document.path)) return decodeHandoverRecord(document);
  return quarantine(`unsupported V1 forge record type or path: ${type ?? "missing"}`);
}

function decodeFeatureRecord(document: VaultDocument): RecordDecodeResult<V1FeatureRecord> {
  const common = readCommonFields(document, "feature record");
  const featureId = readString(document.frontmatter.feature_id);
  if (!featureId) common.diagnostics.push(missingRequiredField("feature_id", "feature record"));
  if (common.diagnostics.length > 0 || !common.record || !featureId) return { status: "repairable", diagnostics: common.diagnostics };
  return {
    status: "valid",
    record: {
      ...common.record,
      kind: "feature",
      featureId,
      prdIds: readStringArray(document.frontmatter.prd_ids),
      sourcePaths: readStringArray(document.frontmatter.source_paths),
      ...optionalString("planningSession", document.frontmatter.planning_session),
    },
  };
}

function decodePrdRecord(document: VaultDocument): RecordDecodeResult<V1PrdRecord> {
  const common = readCommonFields(document, "PRD record");
  const prdId = readString(document.frontmatter.prd_id);
  const parentFeature = readString(document.frontmatter.parent_feature);
  if (!prdId) common.diagnostics.push(missingRequiredField("prd_id", "PRD record"));
  if (!parentFeature) common.diagnostics.push(missingRequiredField("parent_feature", "PRD record"));
  if (common.diagnostics.length > 0 || !common.record || !prdId || !parentFeature) return { status: "repairable", diagnostics: common.diagnostics };
  return {
    status: "valid",
    record: {
      ...common.record,
      kind: "prd",
      prdId,
      parentFeature,
      sliceIds: readStringArray(document.frontmatter.slice_ids),
      ...optionalString("planningSession", document.frontmatter.planning_session),
    },
  };
}

function decodeSliceWorkflowRecord(document: VaultDocument): RecordDecodeResult<V1SliceWorkflowRecord> {
  const common = readCommonFields(document, "slice record");
  const taskId = readString(document.frontmatter.task_id);
  const parentFeature = readString(document.frontmatter.parent_feature);
  const parentPrd = readString(document.frontmatter.parent_prd);
  if (!taskId) common.diagnostics.push(missingRequiredField("task_id", "slice record"));
  if (!parentFeature) common.diagnostics.push(missingRequiredField("parent_feature", "slice record"));
  if (!parentPrd) common.diagnostics.push(missingRequiredField("parent_prd", "slice record"));
  if (common.diagnostics.length > 0 || !common.record || !taskId || !parentFeature || !parentPrd) return { status: "repairable", diagnostics: common.diagnostics };
  return {
    status: "valid",
    record: {
      ...common.record,
      kind: "slice",
      taskId,
      parentFeature,
      parentPrd,
      sourcePaths: readStringArray(document.frontmatter.source_paths),
      ...optionalString("planningSession", document.frontmatter.planning_session),
    },
  };
}

function decodeEvidencePageRecord(document: VaultDocument): RecordDecodeResult<V1EvidencePageRecord> {
  const common = readCommonFields(document, "evidence record");
  const taskId = readString(document.frontmatter.task_id);
  if (!taskId) common.diagnostics.push(missingRequiredField("task_id", "evidence record"));
  if (common.diagnostics.length > 0 || !common.record || !taskId) return { status: "repairable", diagnostics: common.diagnostics };
  return {
    status: "valid",
    record: {
      ...common.record,
      kind: "evidence",
      taskId,
      records: readArray(document.frontmatter.records),
    },
  };
}

function decodeHandoverRecord(document: VaultDocument): RecordDecodeResult<V1HandoverRecord> {
  const diagnostics: V1Diagnostic[] = [];
  const pathProject = inferProjectFromPath(document.path);
  const project = readString(document.frontmatter.project) ?? pathProject;
  const title = readString(document.frontmatter.title);
  const sessionId = readString(document.frontmatter.session_id);
  const createdAt = readString(document.frontmatter.created_at);
  const agent = readString(document.frontmatter.agent);
  const nextAction = readString(document.frontmatter.next_action);
  if (!project) diagnostics.push(missingRequiredField("project", "handover record"));
  else if (pathProject && project !== pathProject) diagnostics.push(projectMismatch(project, pathProject));
  if (!title) diagnostics.push(missingRequiredField("title", "handover record"));
  if (!sessionId) diagnostics.push(missingRequiredField("session_id", "handover record"));
  if (!createdAt) diagnostics.push(missingRequiredField("created_at", "handover record"));
  if (!agent) diagnostics.push(missingRequiredField("agent", "handover record"));
  if (!nextAction) diagnostics.push(missingRequiredField("next_action", "handover record"));
  if (diagnostics.length > 0 || !project || !title || !sessionId || !createdAt || !agent || !nextAction) return { status: "repairable", diagnostics };
  return {
    status: "valid",
    record: {
      kind: "handover",
      path: document.path,
      title,
      project,
      sessionId,
      createdAt,
      agent,
      relatedFeatures: readStringArray(document.frontmatter.related_features),
      relatedPrds: readStringArray(document.frontmatter.related_prds),
      relatedSlices: readStringArray(document.frontmatter.related_slices),
      summary: readFirstSection(document.body, "Summary"),
      nextAction,
      copyPastePrompt: readFencedSection(document.body, "Copy/paste prompt for next session"),
    },
  };
}

function readCommonFields(document: VaultDocument, recordLabel: string): { readonly diagnostics: V1Diagnostic[]; readonly record: null | {
  readonly path: VaultPath;
  readonly title: string;
  readonly project: string;
  readonly status: V1RecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
} } {
  const diagnostics: V1Diagnostic[] = [];
  const pathProject = inferProjectFromPath(document.path);
  const project = readString(document.frontmatter.project) ?? pathProject;
  const title = readString(document.frontmatter.title);
  const status = readStatus(document.frontmatter.status);
  const createdAt = readString(document.frontmatter.created_at);
  const updatedAt = readString(document.frontmatter.updated);
  if (!project) diagnostics.push(missingRequiredField("project", recordLabel));
  else if (pathProject && project !== pathProject) diagnostics.push(projectMismatch(project, pathProject));
  if (!title) diagnostics.push(missingRequiredField("title", recordLabel));
  if (!status) diagnostics.push(invalidFieldType("status", `${recordLabel} status must be draft, ready, in-progress, done, or cancelled`));
  if (!createdAt) diagnostics.push(missingRequiredField("created_at", recordLabel));
  if (!updatedAt) diagnostics.push(missingRequiredField("updated", recordLabel));
  if (diagnostics.length > 0 || !project || !title || !status || !createdAt || !updatedAt) return { diagnostics, record: null };
  return { diagnostics, record: { path: document.path, title, project, status, createdAt, updatedAt } };
}

function readString(value: FrontmatterValue | undefined): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function readStringArray(value: FrontmatterValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : []);
}

function readArray(value: FrontmatterValue | undefined): readonly FrontmatterValue[] {
  return Array.isArray(value) ? value : [];
}

function readStatus(value: FrontmatterValue | undefined): V1RecordStatus | null {
  const raw = readString(value);
  return raw && (VALID_RECORD_STATUSES as readonly string[]).includes(raw) ? raw as V1RecordStatus : null;
}

function optionalString<TKey extends string>(key: TKey, value: FrontmatterValue | undefined): { readonly [K in TKey]?: string } {
  const raw = readString(value);
  return raw ? { [key]: raw } as { readonly [K in TKey]?: string } : {};
}

function readFirstSection(body: string, heading: string): string {
  const match = body.match(new RegExp(`## ${escapeRegExp(heading)}\\n\\n([\\s\\S]*?)(?:\\n## |$)`, "u"));
  return match?.[1]?.trim() ?? "";
}

function readFencedSection(body: string, heading: string): string {
  const section = readFirstSection(body, heading);
  const match = section.match(/```(?:text)?\n([\s\S]*?)\n```/u);
  return match?.[1]?.trim() ?? section;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function missingRequiredField(field: string, recordLabel: string): V1Diagnostic {
  return { code: "MissingRequiredField", field, message: `${recordLabel} is missing required field: ${field}` };
}

function invalidFieldType(field: string, message: string): V1Diagnostic {
  return { code: "InvalidFieldType", field, message };
}

function projectMismatch(project: string, pathProject: string): V1Diagnostic {
  return {
    code: "ProjectMismatch",
    field: "project",
    message: `frontmatter project ${project} does not match path project ${pathProject}`,
  };
}

function quarantine(message: string): RecordDecodeResult<never> {
  return { status: "quarantined", diagnostics: [{ code: "UnknownLifecycleShape", message }] };
}
