import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { createdAt, projectRoot, safeMatter } from "../cli-shared";
import { readText } from "../lib/fs";
import { classifyProjectDocPath, toVaultWikilinkPath } from "../lib/structure";
import { walkMarkdown } from "../lib/vault";

export type SpecIndexGroup = "features" | "prds" | "plans" | "task-hubs";
export type ProjectPageRow = {
  file: string;
  rel: string;
  title: string;
  content: string;
  kind: ReturnType<typeof classifyProjectDocPath>;
  section: string;
  sortKey: string;
  linkPath: string;
  sourcePaths: string[];
  featureId?: string;
  prdId?: string;
  parentFeature?: string;
  parentPrd?: string;
  taskId?: string;
  specGroup: SpecIndexGroup | null;
  skipProjectIndex: boolean;
};

export type ProjectPageIndex = {
  featureRows: ProjectPageRow[];
  prdRows: ProjectPageRow[];
  taskHubRows: ProjectPageRow[];
  sliceRows: ProjectPageRow[];
  moduleRows: ProjectPageRow[];
  freeformRows: ProjectPageRow[];
  featureMap: Map<string, ProjectPageRow>;
  prdMap: Map<string, ProjectPageRow>;
  prdsByFeature: Map<string, ProjectPageRow[]>;
  taskHubsByPrd: Map<string, ProjectPageRow[]>;
};

export async function collectProjectPageRows(project: string): Promise<ProjectPageRow[]> {
  const root = projectRoot(project);
  const pages = (await walkMarkdown(root)).sort();
  return Promise.all(pages.map(async (file) => {
    const rel = relative(root, file).replaceAll("\\", "/");
    const raw = await readText(file);
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    const data = parsed?.data as Record<string, unknown> | undefined;
    let section: string;
    if (rel.includes("/")) {
      section = rel.split("/")[0] ?? "root";
    } else {
      section = "root";
    }
    return {
      file,
      rel,
      title: readTitleFromParsed(parsed, file),
      content: parsed?.content?.replace(/\r\n/g, "\n").trim() ?? "",
      kind: classifyProjectDocPath(rel),
      section,
      sortKey: buildSectionSortKey(section, rel, data),
      linkPath: toVaultWikilinkPath(file),
      sourcePaths: readSourcePaths(data),
      featureId: readString(data?.feature_id),
      prdId: readString(data?.prd_id),
      parentFeature: readString(data?.parent_feature),
      parentPrd: readString(data?.parent_prd),
      taskId: readString(data?.task_id),
      specGroup: section === "specs" ? specIndexGroup(rel, data) : null,
      skipProjectIndex: section === "specs" && shouldSkipProjectIndexSpecEntry(rel),
    } satisfies ProjectPageRow;
  }));
}

export async function readPageTitle(file: string) {
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  return readTitleFromParsed(parsed, file);
}

export function buildProjectPageIndex(pageRows: ProjectPageRow[]): ProjectPageIndex {
  const featureRows = pageRows.filter((row) => row.kind === "spec-feature");
  const prdRows = pageRows.filter((row) => row.kind === "spec-prd");
  const taskHubRows = pageRows.filter((row) => row.kind === "task-hub-index");
  const sliceRows = pageRows.filter((row) => row.kind === "task-hub-index" || row.kind === "task-hub-plan" || row.kind === "task-hub-test-plan");
  const moduleRows = pageRows.filter((row) => row.kind === "module-spec");
  const freeformRows = pageRows.filter((row) => row.kind === "freeform-zone-doc");

  return {
    featureRows,
    prdRows,
    taskHubRows,
    sliceRows,
    moduleRows,
    freeformRows,
    featureMap: new Map(featureRows.map((row) => [row.featureId ?? row.title, row])),
    prdMap: new Map(prdRows.map((row) => [row.prdId ?? row.title, row])),
    prdsByFeature: groupRows(prdRows, (row) => row.parentFeature),
    taskHubsByPrd: groupRows(taskHubRows, (row) => row.parentPrd),
  };
}

export async function collectTaskHubSections(project: string, pageRows: ProjectPageRow[]) {
  const backlogPath = join(projectRoot(project), "backlog.md");
  const raw = await readText(backlogPath);
  const rowsByTaskId = new Map<string, string>();
  for (const row of pageRows) {
    if (!row.taskId || row.kind !== "task-hub-index") continue;
    rowsByTaskId.set(row.taskId, `- [[${row.linkPath}|${row.title}]]`);
  }
  const sections = new Map<string, string[]>();
  let currentSection: string | undefined;
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      sections.set(currentSection, sections.get(currentSection) ?? []);
      continue;
    }
    if (!currentSection) continue;
    const match = line.match(/^- \[[^\]]+\] \*\*([^*]+)\*\*\s+(.*)$/u);
    if (!match) continue;
    const [, taskId, rawTitle] = match;
    if (!taskId) continue;
    const sectionLines = sections.get(currentSection) ?? [];
    sectionLines.push(rowsByTaskId.get(taskId) ?? `- ${taskId} ${rawTitle ?? ""}`.trim());
    sections.set(currentSection, sectionLines);
  }
  return sections;
}

export function selectTaskHubSections(sectionMap: Map<string, string[]>, wantedSections: string[]) {
  return wantedSections.map((section) => [section, sectionMap.get(section) ?? []] as const);
}

export function rowsOverlap(left: ProjectPageRow, right: ProjectPageRow) {
  return left.sourcePaths.length > 0 && right.sourcePaths.length > 0 && pathsOverlap(left.sourcePaths, right.sourcePaths);
}

export function relatedFeaturesFor(featureRows: ProjectPageRow[], prdRows: ProjectPageRow[], sliceRows: ProjectPageRow[]) {
  const featureIds = new Set([...prdRows.map((item) => item.parentFeature), ...sliceRows.map((item) => item.parentFeature)].filter(Boolean));
  return featureRows.filter((item) => featureIds.has(item.featureId ?? ""));
}

export function buildSectionSortKey(section: string, rel: string, data: Record<string, unknown> | undefined) {
  if (section !== "specs") return rel;
  const kindOrder = { feature: "0", prd: "1", "task-hub": "2", plan: "3", "test-plan": "4" } as const;
  const kind = typeof data?.spec_kind === "string" ? data.spec_kind : rel.endsWith("/index.md") ? "task-hub" : "zzz";
  let ordinalSource: string;
  if (typeof data?.feature_id === "string") {
    ordinalSource = data.feature_id;
  } else if (typeof data?.prd_id === "string") {
    ordinalSource = data.prd_id;
  } else if (typeof data?.task_id === "string") {
    ordinalSource = data.task_id;
  } else {
    ordinalSource = "";
  }
  const ordinalMatch = ordinalSource.match(/(\d{3,})$/);
  const ordinal = ordinalMatch ? ordinalMatch[1].padStart(6, "0") : "999999";
  const created = createdAt((data ?? {}) as Record<string, unknown>);
  return `${kindOrder[kind as keyof typeof kindOrder] ?? "9"}:${ordinal}:${created}:${rel}`;
}

export function shouldSkipProjectIndexSpecEntry(rel: string) {
  const kind = classifyProjectDocPath(rel);
  if (kind === "spec-index" || kind === "spec-features-index" || kind === "spec-prds-index" || kind === "spec-slices-index" || kind === "spec-archive-index") return true;
  if (kind === "task-hub-plan" || kind === "task-hub-test-plan") return true;
  return false;
}

export function specIndexGroup(rel: string, data: Record<string, unknown> | undefined): SpecIndexGroup {
  let kind: string | null;
  if (typeof data?.spec_kind === "string") {
    kind = data.spec_kind;
  } else {
    kind = classifyProjectDocPath(rel);
  }
  if (kind === "feature" || kind === "spec-feature") return "features";
  if (kind === "prd" || kind === "spec-prd") return "prds";
  if (kind === "plan" || kind === "test-plan" || kind === "spec-plan" || kind === "spec-test-plan") return "plans";
  return "task-hubs";
}

function groupRows(rows: ProjectPageRow[], readKey: (row: ProjectPageRow) => string | undefined) {
  const grouped = new Map<string, ProjectPageRow[]>();
  for (const row of rows) {
    const key = readKey(row);
    if (!key) continue;
    const items = grouped.get(key) ?? [];
    items.push(row);
    grouped.set(key, items);
  }
  return grouped;
}

function readTitleFromParsed(parsed: ReturnType<typeof safeMatter> | null | undefined, file: string) {
  const title = parsed?.data.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const heading = parsed?.content.split("\n").find((line) => line.startsWith("# "));
  return heading?.replace(/^#\s+/u, "").trim() || relative(VAULT_ROOT, file).replace(/\.md$/u, "");
}

function readSourcePaths(data: Record<string, unknown> | undefined) {
  const value = data?.source_paths;
  return Array.isArray(value) ? value.map((item) => String(item).replaceAll("\\", "/")).filter(Boolean) : [];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pathsOverlap(left: string[], right: string[]) {
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}
