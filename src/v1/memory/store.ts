import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { writeText, readText, exists } from "../../lib/fs";

export type V1MemoryNoteRecord = {
  readonly status: "written";
  readonly kind: "wiki-memory-note";
  readonly project: string;
  readonly path: string;
  readonly id: string;
  readonly agent: string;
  readonly sliceId?: string;
  readonly message: string;
  readonly createdAt: string;
  readonly lifecycleMutation: false;
};

export type V1MemoryLogRecord = {
  readonly status: "written";
  readonly kind: "wiki-memory-log-entry";
  readonly project: string;
  readonly path: string;
  readonly id: string;
  readonly entryKind: string;
  readonly title: string;
  readonly details: readonly string[];
  readonly createdAt: string;
  readonly lifecycleMutation: false;
};

export type V1MemoryLogTail = {
  readonly kind: "wiki-memory-log-tail";
  readonly project: string;
  readonly entries: readonly V1MemoryLogTailEntry[];
};

export type V1MemoryLogTailEntry = {
  readonly kind: "wiki-memory-log-entry";
  readonly project: string;
  readonly path: string;
  readonly id: string;
  readonly entryKind: string;
  readonly title: string;
  readonly details: readonly string[];
  readonly createdAt: string;
  readonly lifecycleMutation: false;
};

export async function writeV1MemoryNote(input: {
  readonly project: string;
  readonly agent: string;
  readonly message: string;
  readonly sliceId?: string;
}): Promise<V1MemoryNoteRecord> {
  const createdAt = new Date().toISOString();
  const id = timestampId(createdAt);
  const relativePath = join("projects", input.project, "memory", "notes", `${id}.md`);
  const record: V1MemoryNoteRecord = {
    status: "written",
    kind: "wiki-memory-note",
    project: input.project,
    path: relativePath,
    id,
    agent: input.agent,
    ...(input.sliceId ? { sliceId: input.sliceId } : {}),
    message: input.message,
    createdAt,
    lifecycleMutation: false,
  };
  await writeText(join(VAULT_ROOT, relativePath), renderNote(record));
  return record;
}

export async function writeV1MemoryLogEntry(input: {
  readonly project: string;
  readonly entryKind: string;
  readonly title: string;
  readonly details?: readonly string[];
}): Promise<V1MemoryLogRecord> {
  const createdAt = new Date().toISOString();
  const id = timestampId(createdAt);
  const relativePath = join("projects", input.project, "memory", "log", `${id}.md`);
  const record: V1MemoryLogRecord = {
    status: "written",
    kind: "wiki-memory-log-entry",
    project: input.project,
    path: relativePath,
    id,
    entryKind: input.entryKind,
    title: input.title,
    details: input.details ?? [],
    createdAt,
    lifecycleMutation: false,
  };
  await writeText(join(VAULT_ROOT, relativePath), renderLogEntry(record));
  return record;
}

export async function tailV1MemoryLog(project: string, count: number): Promise<V1MemoryLogTail> {
  const logDir = join(VAULT_ROOT, "projects", project, "memory", "log");
  if (!(await exists(logDir))) return { kind: "wiki-memory-log-tail", project, entries: [] };
  const entries = await Promise.all(
    readdirSync(logDir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .slice(-count)
      .map(async (name) => parseLogEntry(project, join(logDir, name), join("projects", project, "memory", "log", name))),
  );
  return { kind: "wiki-memory-log-tail", project, entries };
}

function renderNote(record: V1MemoryNoteRecord): string {
  return [
    "---",
    `title: ${yamlString(firstLine(record.message))}`,
    "type: wiki-memory-note",
    `project: ${yamlString(record.project)}`,
    `memory_id: ${yamlString(record.id)}`,
    `created_at: ${yamlString(record.createdAt)}`,
    `agent: ${yamlString(record.agent)}`,
    ...(record.sliceId ? [`slice_id: ${yamlString(record.sliceId)}`] : []),
    "lifecycle_mutation: false",
    "---",
    `# ${firstLine(record.message)}`,
    "",
    record.message,
    "",
  ].join("\n");
}

function renderLogEntry(record: V1MemoryLogRecord): string {
  return [
    "---",
    `title: ${yamlString(record.title)}`,
    "type: wiki-memory-log-entry",
    `project: ${yamlString(record.project)}`,
    `memory_id: ${yamlString(record.id)}`,
    `entry_kind: ${yamlString(record.entryKind)}`,
    `created_at: ${yamlString(record.createdAt)}`,
    "lifecycle_mutation: false",
    ...(record.details.length ? ["details:", ...record.details.map((detail) => `  - ${yamlString(detail)}`)] : []),
    "---",
    `# ${record.title}`,
    "",
    ...record.details.map((detail) => `- ${detail}`),
    "",
  ].join("\n");
}

async function parseLogEntry(project: string, absolutePath: string, relativePath: string): Promise<V1MemoryLogTailEntry> {
  const content = await readText(absolutePath);
  return {
    kind: "wiki-memory-log-entry",
    project,
    path: relativePath,
    id: readFrontmatterValue(content, "memory_id") ?? basename(relativePath, ".md"),
    entryKind: readFrontmatterValue(content, "entry_kind") ?? "entry",
    title: readFrontmatterValue(content, "title") ?? "Untitled",
    details: readFrontmatterList(content, "details"),
    createdAt: readFrontmatterValue(content, "created_at") ?? "",
    lifecycleMutation: false,
  };
}

function readFrontmatterValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*['\"]?(.+?)['\"]?\\s*$`, "m"));
  return match?.[1];
}

function readFrontmatterList(content: string, key: string): readonly string[] {
  const block = content.match(new RegExp(`^${key}:\\n((?:  - .+\\n?)*)`, "m"));
  if (!block) return [];
  return block[1].split("\n").map((line) => line.replace(/^  -\s*/, "").trim()).filter(Boolean).map(unquoteYamlString);
}

function timestampId(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/u)[0] || "Memory entry";
}

function yamlString(value: string): string {
  if (/^[A-Za-z0-9_-]+$/u.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function unquoteYamlString(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}
