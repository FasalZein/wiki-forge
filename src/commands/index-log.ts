import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { createdAt, mkdirIfMissing, nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText, writeText } from "../lib/fs";
import { tailLog, appendLogEntry } from "../lib/log";
import { classifyProjectDocPath, projectSpecsIndexPath, projectSpecViewIndexPath } from "../lib/structure";
import { walkMarkdown } from "../lib/vault";

type IndexTarget = { path: string; content: string };
type ProjectPageRow = {
  file: string;
  rel: string;
  title: string;
  parsed: ReturnType<typeof safeMatter> | null | undefined;
};

export async function updateIndex(args: string[]) {
  const json = args.includes("--json");
  const write = args.includes("--write");
  const all = args.includes("--all");
  const project = all ? undefined : args.find((arg) => !arg.startsWith("--"));
  if (!all) requireValue(project, "project or --all");
  const result = await buildIndexPlan(project, all);
  if (write) await applyIndexPlan(result);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${write ? "updated" : "would update"} ${result.targets.length} index file(s)`);
    for (const target of result.targets) console.log(`- ${target.path}`);
  }
}

export function logCommand(args: string[]) {
  const subcommand = args[0] ?? "tail";
  if (subcommand === "append") {
    const kind = args[1];
    const title = args[2];
    requireValue(kind, "kind");
    requireValue(title, "title");
    const projectIndex = args.indexOf("--project");
    const detailsIndex = args.indexOf("--details");
    appendLogEntry(kind, title, {
      project: projectIndex >= 0 ? args[projectIndex + 1] : undefined,
      details: detailsIndex >= 0 ? [args.slice(detailsIndex + 1).join(" ").trim()].filter(Boolean) : [],
    });
    return console.log(`appended log entry: ${kind} | ${title}`);
  }
  const count = subcommand === "tail" ? Number.parseInt(args[1] ?? "10", 10) : 10;
  for (const entry of tailLog(Number.isFinite(count) && count > 0 ? count : 10)) console.log(`${entry}\n`);
}

async function buildIndexPlan(project: string | undefined, all: boolean) {
  const targets: IndexTarget[] = [];
  if (all) {
    const projectsRoot = join(VAULT_ROOT, "projects");
    const projects = existsSync(projectsRoot) ? readdirSync(projectsRoot).filter((entry) => statSync(join(projectsRoot, entry)).isDirectory()).sort() : [];
    const lines = ["# Index", "", "## Projects", ""];
    const projectTitles = await Promise.all(projects.map(async (name) => {
      const summaryPath = join(projectRoot(name), "_summary.md");
      return { name, title: existsSync(summaryPath) ? await readPageTitle(summaryPath) : name };
    }));
    for (const { name, title } of projectTitles) lines.push(`- [[projects/${name}/_summary|${title}]]`);
    lines.push("");
    targets.push({ path: "index.md", content: `${lines.join("\n")}\n` });
    for (const name of projects) targets.push(...await buildProjectIndexTargets(name));
    return { all, project: null, targets };
  }
  targets.push(...await buildProjectIndexTargets(project!));
  return { all, project: project!, targets };
}

async function applyIndexPlan(plan: { targets: IndexTarget[] }) {
  for (const target of plan.targets) {
    const absolutePath = join(VAULT_ROOT, target.path);
    mkdirIfMissing(dirname(absolutePath));
    await writeIndexTarget(absolutePath, target.content);
  }
}

export async function writeProjectIndex(project: string) {
  const targets = await buildProjectIndexTargets(project);
  await applyIndexPlan({ targets });
  return targets;
}

async function buildProjectIndexTargets(project: string): Promise<IndexTarget[]> {
  const pageRows = await collectProjectPageRows(project);
  return [
    ...buildPlanningDerivedTargets(pageRows),
    buildProjectOverviewIndexTarget(project, pageRows),
    await buildSpecFamilyIndexTarget(project, pageRows, "features"),
    await buildSpecFamilyIndexTarget(project, pageRows, "prds"),
    await buildSpecFamilyIndexTarget(project, pageRows, "slices"),
    await buildSpecFamilyIndexTarget(project, pageRows, "archive"),
  ];
}

async function collectProjectPageRows(project: string): Promise<ProjectPageRow[]> {
  const root = projectRoot(project);
  const pages = walkMarkdown(root).sort();
  return Promise.all(pages.map(async (file) => {
    const rel = relative(root, file).replaceAll("\\", "/");
    const raw = await readText(file);
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    const title = readTitleFromParsed(parsed, file);
    return { file, rel, title, parsed };
  }));
}

function buildPlanningDerivedTargets(pageRows: ProjectPageRow[]): IndexTarget[] {
  const featureRows = pageRows.filter((row) => classifyProjectDocPath(row.rel) === "spec-feature");
  const prdRows = pageRows.filter((row) => classifyProjectDocPath(row.rel) === "spec-prd");
  const taskHubRows = pageRows.filter((row) => classifyProjectDocPath(row.rel) === "task-hub-index");
  const sliceRows = pageRows.filter((row) => {
    const kind = classifyProjectDocPath(row.rel);
    return kind === "task-hub-index" || kind === "task-hub-plan" || kind === "task-hub-test-plan";
  });
  const moduleRows = pageRows.filter((row) => classifyProjectDocPath(row.rel) === "module-spec");
  const freeformRows = pageRows.filter((row) => classifyProjectDocPath(row.rel) === "freeform-zone-doc");

  const prdsByFeature = new Map<string, ProjectPageRow[]>();
  for (const row of prdRows) {
    const featureId = frontmatterString(row, "parent_feature");
    if (!featureId) continue;
    const rows = prdsByFeature.get(featureId) ?? [];
    rows.push(row);
    prdsByFeature.set(featureId, rows);
  }

  const taskHubsByPrd = new Map<string, ProjectPageRow[]>();
  for (const row of taskHubRows) {
    const prdId = frontmatterString(row, "parent_prd");
    if (!prdId) continue;
    const rows = taskHubsByPrd.get(prdId) ?? [];
    rows.push(row);
    taskHubsByPrd.set(prdId, rows);
  }

  const featureMap = new Map(featureRows.map((row) => [frontmatterString(row, "feature_id") ?? row.title, row]));
  const prdMap = new Map(prdRows.map((row) => [frontmatterString(row, "prd_id") ?? row.title, row]));

  return [
    ...featureRows.map((row) => buildFeatureDerivedTarget(row, prdsByFeature.get(frontmatterString(row, "feature_id") ?? "") ?? [], taskHubRows, moduleRows)),
    ...prdRows.map((row) => buildPrdDerivedTarget(row, featureMap.get(frontmatterString(row, "parent_feature") ?? ""), taskHubsByPrd.get(frontmatterString(row, "prd_id") ?? "") ?? [], moduleRows)),
    ...sliceRows.map((row) => buildSliceDerivedTarget(row, prdMap.get(frontmatterString(row, "parent_prd") ?? ""), featureMap.get(frontmatterString(row, "parent_feature") ?? ""), moduleRows)),
    ...moduleRows.map((row) => buildModuleDerivedTarget(row, featureRows, prdRows, taskHubRows)),
    ...freeformRows.map((row) => buildFreeformDerivedTarget(row, featureRows, prdRows, taskHubRows, moduleRows)),
  ];
}

function buildFeatureDerivedTarget(row: ProjectPageRow, prdRows: ProjectPageRow[], taskHubRows: ProjectPageRow[], moduleRows: ProjectPageRow[]): IndexTarget {
  const orderedPrds = prdRows.sort((a, b) => buildSectionSortKey("specs", a.rel, a.parsed?.data).localeCompare(buildSectionSortKey("specs", b.rel, b.parsed?.data)));
  const childPrdIds = new Set(orderedPrds.map((item) => frontmatterString(item, "prd_id")).filter(Boolean));
  const childSlices = taskHubRows.filter((item) => childPrdIds.has(frontmatterString(item, "parent_prd") ?? ""));
  const relatedModules = moduleRows.filter((item) => [...orderedPrds, ...childSlices].some((candidate) => rowsOverlap(item, candidate)));
  const content = rewriteSections(row, [
    { heading: "Included PRDs", lines: renderLinks(orderedPrds), insertBefore: "Cross Links" },
    { heading: "Child Slices", lines: renderLinks(childSlices), insertBefore: "Cross Links" },
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
  ]);
  return { path: relative(VAULT_ROOT, row.file).replaceAll("\\", "/"), content };
}

function buildPrdDerivedTarget(row: ProjectPageRow, featureRow: ProjectPageRow | undefined, taskHubRows: ProjectPageRow[], moduleRows: ProjectPageRow[]): IndexTarget {
  const relatedModules = moduleRows.filter((item) => [row, ...taskHubRows].some((candidate) => rowsOverlap(item, candidate)));
  const content = rewriteSections(row, [
    { heading: "Parent Feature", lines: featureRow ? [linkLine(featureRow)] : ["- none"] },
    { heading: "Child Slices", lines: renderLinks(taskHubRows), insertBefore: "Cross Links" },
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
  ]);
  return { path: relative(VAULT_ROOT, row.file).replaceAll("\\", "/"), content };
}

function buildSliceDerivedTarget(row: ProjectPageRow, prdRow: ProjectPageRow | undefined, featureRow: ProjectPageRow | undefined, moduleRows: ProjectPageRow[]): IndexTarget {
  const relatedModules = moduleRows.filter((item) => rowsOverlap(item, row));
  const content = rewriteSections(row, [
    { heading: "Parent PRD", lines: prdRow ? [linkLine(prdRow)] : ["- none"] },
    { heading: "Parent Feature", lines: featureRow ? [linkLine(featureRow)] : ["- none"], insertBefore: row.rel.endsWith("index.md") ? "Documents" : "Task" },
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
  ]);
  return { path: relative(VAULT_ROOT, row.file).replaceAll("\\", "/"), content };
}

function buildModuleDerivedTarget(row: ProjectPageRow, featureRows: ProjectPageRow[], prdRows: ProjectPageRow[], taskHubRows: ProjectPageRow[]): IndexTarget {
  const relatedPrds = prdRows.filter((item) => rowsOverlap(row, item));
  const relatedSlices = taskHubRows.filter((item) => rowsOverlap(row, item));
  const relatedFeatures = relatedFeaturesFor(featureRows, relatedPrds, relatedSlices);
  const content = rewriteSections(row, [{
    heading: "Related Planning",
    lines: relatedPlanningLines(relatedFeatures, relatedPrds, relatedSlices),
    insertBefore: "Cross Links",
  }]);
  return { path: relative(VAULT_ROOT, row.file).replaceAll("\\", "/"), content };
}

function buildFreeformDerivedTarget(row: ProjectPageRow, featureRows: ProjectPageRow[], prdRows: ProjectPageRow[], taskHubRows: ProjectPageRow[], moduleRows: ProjectPageRow[]): IndexTarget {
  const relatedModules = moduleRows.filter((item) => rowsOverlap(row, item));
  const relatedPrds = prdRows.filter((item) => rowsOverlap(row, item));
  const relatedSlices = taskHubRows.filter((item) => rowsOverlap(row, item));
  const relatedFeatures = relatedFeaturesFor(featureRows, relatedPrds, relatedSlices);
  const content = rewriteSections(row, [
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
    { heading: "Related Planning", lines: relatedPlanningLines(relatedFeatures, relatedPrds, relatedSlices), insertBefore: "Cross Links" },
  ]);
  return { path: relative(VAULT_ROOT, row.file).replaceAll("\\", "/"), content };
}

function rewriteSections(row: ProjectPageRow, sections: Array<{ heading: string; lines: string[]; insertBefore?: string }>) {
  let content = row.parsed?.content?.replace(/\r\n/g, "\n").trim() ?? "";
  for (const section of sections) content = upsertSection(content, section.heading, section.lines, section.insertBefore);
  return `${content.trim()}\n`;
}

function upsertSection(content: string, heading: string, lines: string[], insertBefore?: string) {
  const section = `## ${heading}`;
  const body = lines.length ? lines.join("\n") : "- none";
  const pattern = new RegExp(`## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |$)`, "u");
  if (pattern.test(content)) return content.replace(pattern, `${section}\n\n${body}\n`);
  const anchor = insertBefore ? `## ${insertBefore}` : "## Cross Links";
  if (content.includes(anchor)) return content.replace(anchor, `${section}\n\n${body}\n\n${anchor}`);
  return `${content.trim()}\n\n${section}\n\n${body}\n`;
}

function renderLinks(rows: ProjectPageRow[]) {
  return rows.length ? rows.map((row) => linkLine(row)) : ["- none"];
}

function linkLine(row: ProjectPageRow) {
  return `- [[${relative(VAULT_ROOT, row.file).replace(/\.md$/u, "").replaceAll("\\", "/")}|${row.title}]]`;
}

function frontmatterString(row: ProjectPageRow, key: string) {
  const value = row.parsed?.data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourcePaths(row: ProjectPageRow) {
  const value = row.parsed?.data?.source_paths;
  return Array.isArray(value) ? value.map((item) => String(item).replaceAll("\\", "/")).filter(Boolean) : [];
}

function rowsOverlap(left: ProjectPageRow, right: ProjectPageRow) {
  const leftPaths = sourcePaths(left);
  const rightPaths = sourcePaths(right);
  return leftPaths.length > 0 && rightPaths.length > 0 && pathsOverlap(leftPaths, rightPaths);
}

function relatedFeaturesFor(featureRows: ProjectPageRow[], prdRows: ProjectPageRow[], sliceRows: ProjectPageRow[]) {
  const featureIds = new Set([
    ...prdRows.map((item) => frontmatterString(item, "parent_feature")),
    ...sliceRows.map((item) => frontmatterString(item, "parent_feature")),
  ].filter(Boolean));
  return featureRows.filter((item) => featureIds.has(frontmatterString(item, "feature_id") ?? ""));
}

function relatedPlanningLines(featureRows: ProjectPageRow[], prdRows: ProjectPageRow[], sliceRows: ProjectPageRow[]) {
  return [
    "### Features",
    "",
    ...renderLinks(featureRows),
    "",
    "### PRDs",
    "",
    ...renderLinks(prdRows),
    "",
    "### Slices",
    "",
    ...renderLinks(sliceRows),
  ];
}

function pathsOverlap(left: string[], right: string[]) {
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProjectOverviewIndexTarget(project: string, pageRows: ProjectPageRow[]): IndexTarget {
  const sections = new Map<string, Array<{ line: string; sortKey: string; rel: string; data: Record<string, unknown> | undefined }>>();
  for (const { file, rel, title, parsed } of pageRows) {
    const section = rel.includes("/") ? rel.split("/")[0] : "root";
    if (section === "specs" && shouldSkipProjectIndexSpecEntry(rel)) continue;
    const vaultPath = relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/");
    const lines = sections.get(section) ?? [];
    lines.push({ line: `- [[${vaultPath}|${title}]]`, sortKey: buildSectionSortKey(section, rel, parsed?.data), rel, data: parsed?.data as Record<string, unknown> | undefined });
    sections.set(section, lines);
  }

  const featuresView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "features")).replace(/\.md$/u, "").replaceAll("\\", "/");
  const prdsView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "prds")).replace(/\.md$/u, "").replaceAll("\\", "/");
  const slicesView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "slices")).replace(/\.md$/u, "").replaceAll("\\", "/");
  const archiveView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "archive")).replace(/\.md$/u, "").replaceAll("\\", "/");

  const out = [`# ${project} Index`, "", `- [[projects/${project}/_summary|${project} summary]]`, ""];
  for (const [section, lines] of [...sections.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`## ${section}`, "");
    if (section === "specs") {
      const features = lines.filter((entry) => specIndexGroup(entry.rel, entry.data) === "features").sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      const prds = lines.filter((entry) => specIndexGroup(entry.rel, entry.data) === "prds").sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      const taskHubs = lines.filter((entry) => specIndexGroup(entry.rel, entry.data) === "task-hubs").sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      const plans = lines.filter((entry) => specIndexGroup(entry.rel, entry.data) === "plans").sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      out.push("### Views", "", `- [[${featuresView}|Feature Index]]`, `- [[${prdsView}|PRD Index]]`, `- [[${slicesView}|Slice Index]]`, `- [[${archiveView}|Archive Index]]`, "");
      if (features.length) out.push("### Features", "", ...features.map((entry) => entry.line), "");
      if (prds.length) out.push("### PRDs", "", ...prds.map((entry) => entry.line), "");
      if (taskHubs.length) out.push("### Task Hubs", "", ...taskHubs.map((entry) => entry.line), "");
      if (plans.length) out.push("### Planning Docs", "", ...plans.map((entry) => entry.line), "");
      continue;
    }
    out.push(...lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((entry) => entry.line), "");
  }
  return { path: relative(VAULT_ROOT, projectSpecsIndexPath(project)).replaceAll("\\", "/"), content: `${out.join("\n")}\n` };
}

async function buildSpecFamilyIndexTarget(project: string, pageRows: ProjectPageRow[], family: "features" | "prds" | "slices" | "archive"): Promise<IndexTarget> {
  const familyPath = relative(VAULT_ROOT, projectSpecViewIndexPath(project, family)).replaceAll("\\", "/");
  const specsIndex = relative(VAULT_ROOT, projectSpecsIndexPath(project)).replace(/\.md$/u, "").replaceAll("\\", "/");

  if (family === "features") {
    const features = pageRows
      .filter((row) => specIndexGroup(row.rel, row.parsed?.data as Record<string, unknown> | undefined) === "features")
      .sort((a, b) => buildSectionSortKey("specs", a.rel, a.parsed?.data).localeCompare(buildSectionSortKey("specs", b.rel, b.parsed?.data)))
      .map((row) => `- [[${relative(VAULT_ROOT, row.file).replace(/\.md$/u, "").replaceAll("\\", "/")}|${row.title}]]`);
    const out = [
      `# ${project} Features`,
      "",
      `- [[projects/${project}/_summary|${project} summary]]`,
      `- [[${specsIndex}|spec index]]`,
      "",
      "## Product Features",
      "",
      ...(features.length ? features : ["- none"]),
      "",
    ];
    return { path: familyPath, content: `${out.join("\n")}\n` };
  }

  if (family === "prds") {
    const featureTitles = new Map<string, string>();
    for (const row of pageRows) {
      const featureId = typeof row.parsed?.data.feature_id === "string" ? row.parsed.data.feature_id : undefined;
      if (featureId && specIndexGroup(row.rel, row.parsed?.data as Record<string, unknown> | undefined) === "features") featureTitles.set(featureId, row.title);
    }
    const prds = pageRows
      .filter((row) => specIndexGroup(row.rel, row.parsed?.data as Record<string, unknown> | undefined) === "prds")
      .sort((a, b) => buildSectionSortKey("specs", a.rel, a.parsed?.data).localeCompare(buildSectionSortKey("specs", b.rel, b.parsed?.data)));
    const grouped = new Map<string, string[]>();
    for (const row of prds) {
      const parentFeature = typeof row.parsed?.data.parent_feature === "string" ? row.parsed.data.parent_feature : "unscoped";
      const lines = grouped.get(parentFeature) ?? [];
      lines.push(`- [[${relative(VAULT_ROOT, row.file).replace(/\.md$/u, "").replaceAll("\\", "/")}|${row.title}]]`);
      grouped.set(parentFeature, lines);
    }
    const out = [
      `# ${project} PRDs`,
      "",
      `- [[projects/${project}/_summary|${project} summary]]`,
      `- [[${specsIndex}|spec index]]`,
      "",
    ];
    if (!grouped.size) out.push("## Project Requirement Docs", "", "- none", "");
    else {
      for (const featureId of [...grouped.keys()].sort()) {
        out.push(`## ${featureTitles.get(featureId) ?? featureId}`, "", ...(grouped.get(featureId) ?? ["- none"]), "");
      }
    }
    return { path: familyPath, content: `${out.join("\n")}\n` };
  }

  if (family === "slices") {
    const sections = await buildTaskHubSections(project, pageRows, ["In Progress", "Todo", "Backlog", "Done", "Cancelled"]);
    const out = [
      `# ${project} Slices`,
      "",
      `- [[projects/${project}/_summary|${project} summary]]`,
      `- [[${specsIndex}|spec index]]`,
      `- [[projects/${project}/backlog|backlog]]`,
      "",
    ];
    for (const [heading, lines] of sections) out.push(`## ${heading}`, "", ...(lines.length ? lines : ["- none"]), "");
    return { path: familyPath, content: `${out.join("\n")}\n` };
  }

  const archiveSections = await buildTaskHubSections(project, pageRows, ["Done", "Cancelled"]);
  const out = [
    `# ${project} Archive`,
    "",
    `- [[projects/${project}/_summary|${project} summary]]`,
    `- [[${specsIndex}|spec index]]`,
    "",
    "> [!summary]",
    "> Generated archive/history view. Physical archive paths can be added later without changing the canonical task workspace model.",
    "",
  ];
  for (const [heading, lines] of archiveSections) out.push(`## ${heading}`, "", ...(lines.length ? lines : ["- none"]), "");
  return { path: familyPath, content: `${out.join("\n")}\n` };
}

async function buildTaskHubSections(project: string, pageRows: ProjectPageRow[], wantedSections: string[]) {
  const backlogPath = join(projectRoot(project), "backlog.md");
  const raw = await readText(backlogPath);
  const rowsByTaskId = new Map<string, string>();
  for (const row of pageRows) {
    const taskId = typeof row.parsed?.data.task_id === "string" ? row.parsed.data.task_id : undefined;
    if (!taskId || classifyProjectDocPath(row.rel) !== "task-hub-index") continue;
    rowsByTaskId.set(taskId, `- [[${relative(VAULT_ROOT, row.file).replace(/\.md$/u, "").replaceAll("\\", "/")}|${row.title}]]`);
  }
  const sections = new Map<string, string[]>();
  let currentSection: string | undefined;
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      if (wantedSections.includes(currentSection)) sections.set(currentSection, []);
      continue;
    }
    if (!currentSection || !wantedSections.includes(currentSection)) continue;
    const match = line.match(/^- \[[^\]]+\] \*\*([^*]+)\*\*\s+(.*)$/u);
    if (!match) continue;
    const [, taskId, rawTitle] = match;
    if (!taskId) continue;
    const sectionLines = sections.get(currentSection) ?? [];
    sectionLines.push(rowsByTaskId.get(taskId) ?? `- ${taskId} ${rawTitle ?? ""}`.trim());
    sections.set(currentSection, sectionLines);
  }
  return wantedSections.map((section) => [section, sections.get(section) ?? []] as const);
}

async function readPageTitle(file: string) {
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  return readTitleFromParsed(parsed, file);
}

function readTitleFromParsed(parsed: ReturnType<typeof safeMatter> | null | undefined, file: string) {
  const title = parsed?.data.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const heading = parsed?.content.split("\n").find((line) => line.startsWith("# "));
  return heading?.replace(/^#\s+/u, "").trim() || relative(VAULT_ROOT, file).replace(/\.md$/u, "");
}

function buildSectionSortKey(section: string, rel: string, data: Record<string, unknown> | undefined) {
  if (section !== "specs") return rel;
  const kindOrder = { feature: "0", prd: "1", "task-hub": "2", plan: "3", "test-plan": "4" } as const;
  const kind = typeof data?.spec_kind === "string" ? data.spec_kind : rel.endsWith("/index.md") ? "task-hub" : "zzz";
  const ordinalSource = typeof data?.feature_id === "string"
    ? data.feature_id
    : typeof data?.prd_id === "string"
      ? data.prd_id
      : typeof data?.task_id === "string"
        ? data.task_id
        : "";
  const ordinalMatch = ordinalSource.match(/(\d{3,})$/);
  const ordinal = ordinalMatch ? ordinalMatch[1].padStart(6, "0") : "999999";
  const created = createdAt((data ?? {}) as Record<string, unknown>);
  return `${kindOrder[kind as keyof typeof kindOrder] ?? "9"}:${ordinal}:${created}:${rel}`;
}

function shouldSkipProjectIndexSpecEntry(rel: string) {
  const kind = classifyProjectDocPath(rel);
  if (kind === "spec-index" || kind === "spec-features-index" || kind === "spec-prds-index" || kind === "spec-slices-index" || kind === "spec-archive-index") return true;
  if (kind === "task-hub-plan" || kind === "task-hub-test-plan") return true;
  return false;
}

function specIndexGroup(rel: string, data: Record<string, unknown> | undefined) {
  const kind = typeof data?.spec_kind === "string" ? data.spec_kind : classifyProjectDocPath(rel);
  if (kind === "feature" || kind === "spec-feature") return "features";
  if (kind === "prd" || kind === "spec-prd") return "prds";
  if (kind === "plan" || kind === "test-plan" || kind === "spec-plan" || kind === "spec-test-plan") return "plans";
  return "task-hubs";
}

async function writeIndexTarget(absolutePath: string, content: string) {
  const relPath = relative(VAULT_ROOT, absolutePath).replaceAll("\\", "/");
  if (!existsSync(absolutePath)) {
    const generated = generatedIndexFrontmatter(relPath);
    if (!generated) return writeText(absolutePath, content);
    return writeNormalizedPage(absolutePath, content, generated);
  }
  const raw = await readText(absolutePath);
  const parsed = safeMatter(relative(VAULT_ROOT, absolutePath), raw, { silent: true });
  if (!parsed) {
    const generated = generatedIndexFrontmatter(relPath);
    if (!generated) return writeText(absolutePath, content);
    return writeNormalizedPage(absolutePath, content, generated);
  }
  const generated = generatedIndexFrontmatter(relPath) ?? {};
  const generatedSources = Array.isArray(generated.source_paths) ? generated.source_paths : [];
  const parsedSources = Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths : [];
  const data = orderFrontmatter({
    ...generated,
    ...parsed.data,
    source_paths: [...new Set([...generatedSources, ...parsedSources])],
    updated: nowIso(),
  }, ["title", "type", "project", "source_paths", "created_at", "updated", "status", "verification_level"]);
  writeNormalizedPage(absolutePath, content, data);
}

function generatedIndexFrontmatter(relPath: string) {
  const match = relPath.match(/^projects\/([^/]+)\/specs(?:\/(features|prds|slices|archive))?\/index\.md$/u);
  if (!match) return null;
  const [, project, family] = match;
  const title = family === "features"
    ? `${project} Features`
    : family === "prds"
      ? `${project} PRDs`
      : family === "slices"
        ? `${project} Slices`
        : family === "archive"
          ? `${project} Archive`
          : `${project} Index`;
  return orderFrontmatter({
    title,
    type: "index",
    project,
    source_paths: ["src/commands/index-log.ts", "src/lib/structure.ts", "src/commands/backlog.ts"],
    updated: nowIso(),
    status: "current",
    verification_level: "code-verified",
  }, ["title", "type", "project", "source_paths", "updated", "status", "verification_level"]);
}
