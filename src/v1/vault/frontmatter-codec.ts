import matter from "gray-matter";
import type { FrontmatterMap, FrontmatterValue, ProjectRecord, RecordDecodeResult, SliceRecord, V1Diagnostic, V1RecordStatus, VaultDocument } from "./document";
import { inferProjectFromPath, isProjectIndexPath, isSliceHubPath } from "./path";

const VALID_RECORD_STATUSES = ["draft", "ready", "in-progress", "done", "cancelled"] as const satisfies readonly V1RecordStatus[];

export function parseVaultDocument(path: string, markdown: string): VaultDocument {
  const parsed = matter(markdown) as { readonly content: string; readonly data: Record<string, unknown> };
  return {
    path,
    frontmatter: normalizeFrontmatter(parsed.data),
    body: parsed.content,
  };
}

export function decodeSliceRecord(document: VaultDocument): RecordDecodeResult<SliceRecord> {
  const diagnostics: V1Diagnostic[] = [];
  if (!isSliceHubPath(document.path)) {
    return quarantine("document path is not a canonical slice hub path");
  }

  const pathProject = inferProjectFromPath(document.path);
  const project = readString(document.frontmatter.project);
  const taskId = readString(document.frontmatter.task_id);
  const title = readString(document.frontmatter.title);
  const status = readStatus(document.frontmatter.status);
  const specKind = readString(document.frontmatter.spec_kind);

  if (!project) diagnostics.push(missingRequiredField("project", "slice record"));
  else if (pathProject && project !== pathProject) {
    diagnostics.push({
      code: "ProjectMismatch",
      field: "project",
      message: `frontmatter project ${project} does not match path project ${pathProject}`,
    });
  }
  if (!taskId) diagnostics.push(missingRequiredField("task_id", "slice record"));
  if (!title) diagnostics.push(missingRequiredField("title", "slice record"));
  if (!status) diagnostics.push(invalidFieldType("status", "slice record status must be draft, ready, in-progress, done, or cancelled"));
  if (specKind !== "task-hub") {
    diagnostics.push({ code: "InvalidFieldType", field: "spec_kind", message: "slice record spec_kind must be task-hub" });
  }
  if (diagnostics.length > 0 || !project || !taskId || !title || !status || specKind !== "task-hub") {
    return { status: "repairable", diagnostics };
  }

  const record: SliceRecord = {
    kind: "slice",
    path: document.path,
    project,
    taskId,
    title,
    status,
    specKind: "task-hub",
    sourcePaths: readStringArray(document.frontmatter.source_paths),
  };
  const parentPrd = readString(document.frontmatter.parent_prd);
  const parentFeature = readString(document.frontmatter.parent_feature);
  return {
    status: "valid",
    record: {
      ...record,
      ...(parentPrd ? { parentPrd } : {}),
      ...(parentFeature ? { parentFeature } : {}),
    },
  };
}

export function decodeProjectRecord(document: VaultDocument): RecordDecodeResult<ProjectRecord> {
  const diagnostics: V1Diagnostic[] = [];
  if (!isProjectIndexPath(document.path)) {
    return quarantine("document path is not a canonical project index path");
  }

  const pathProject = inferProjectFromPath(document.path);
  const project = readString(document.frontmatter.project) ?? pathProject;
  const title = readString(document.frontmatter.title);

  if (!project) diagnostics.push(missingRequiredField("project", "project record"));
  else if (pathProject && project !== pathProject) {
    diagnostics.push({
      code: "ProjectMismatch",
      field: "project",
      message: `frontmatter project ${project} does not match path project ${pathProject}`,
    });
  }
  if (!title) diagnostics.push(missingRequiredField("title", "project record"));
  if (diagnostics.length > 0 || !project || !title) return { status: "repairable", diagnostics };

  return {
    status: "valid",
    record: {
      kind: "project",
      path: document.path,
      project,
      title,
      sourcePaths: readStringArray(document.frontmatter.source_paths),
    },
  };
}

function normalizeFrontmatter(data: Record<string, unknown>): FrontmatterMap {
  const normalized: Record<string, FrontmatterValue | undefined> = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = normalizeFrontmatterValue(value);
  }
  return normalized;
}

function normalizeFrontmatterValue(value: unknown): FrontmatterValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeFrontmatterValue(entry) ?? null);
  if (typeof value === "object") {
    const normalized: Record<string, FrontmatterValue> = {};
    for (const [key, entry] of Object.entries(value)) normalized[key] = normalizeFrontmatterValue(entry) ?? null;
    return normalized;
  }
  return String(value);
}

function readString(value: FrontmatterValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: FrontmatterValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : []);
}

function readStatus(value: FrontmatterValue | undefined): V1RecordStatus | null {
  const raw = readString(value);
  return raw && (VALID_RECORD_STATUSES as readonly string[]).includes(raw) ? raw as V1RecordStatus : null;
}

function missingRequiredField(field: string, recordLabel: string): V1Diagnostic {
  return {
    code: "MissingRequiredField",
    field,
    message: `${recordLabel} is missing required field: ${field}`,
  };
}

function invalidFieldType(field: string, message: string): V1Diagnostic {
  return { code: "InvalidFieldType", field, message };
}

function quarantine(message: string): RecordDecodeResult<never> {
  return {
    status: "quarantined",
    diagnostics: [{ code: "UnknownLifecycleShape", message }],
  };
}

