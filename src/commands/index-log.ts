import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText, writeText } from "../lib/fs";
import { tailLog, appendLogEntry } from "../lib/log";
import { projectSpecsIndexPath, projectSpecViewIndexPath } from "../lib/structure";
import {
  buildProjectPageIndex,
  collectProjectPageRows,
  collectTaskHubSections,
  readPageTitle,
  relatedFeaturesFor,
  rowsOverlap,
  selectTaskHubSections,
  type ProjectPageRow,
  type SpecIndexGroup,
} from "./index-log-relationships";
import { linkLine, relatedPlanningLines, renderLinks, rewriteRowSections } from "./index-log-markdown";

type IndexTarget = { path: string; content: string };
type SectionEntry = { line: string; sortKey: string; specGroup: SpecIndexGroup | null };

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
  const pageIndex = buildProjectPageIndex(pageRows);
  const taskHubSections = await collectTaskHubSections(project, pageRows);
  return [
    ...buildPlanningDerivedTargets(pageIndex),
    buildProjectOverviewIndexTarget(project, pageRows),
    buildSpecFamilyIndexTarget(project, pageRows, taskHubSections, "features"),
    buildSpecFamilyIndexTarget(project, pageRows, taskHubSections, "prds"),
    buildSpecFamilyIndexTarget(project, pageRows, taskHubSections, "slices"),
    buildSpecFamilyIndexTarget(project, pageRows, taskHubSections, "archive"),
  ];
}

function buildPlanningDerivedTargets(pageIndex: ReturnType<typeof buildProjectPageIndex>): IndexTarget[] {
  return [
    ...pageIndex.featureRows.map((row) => buildFeatureDerivedTarget(row, pageIndex)),
    ...pageIndex.prdRows.map((row) => buildPrdDerivedTarget(row, pageIndex)),
    ...pageIndex.sliceRows.map((row) => buildSliceDerivedTarget(row, pageIndex)),
    ...pageIndex.moduleRows.map((row) => buildModuleDerivedTarget(row, pageIndex)),
    ...pageIndex.freeformRows.map((row) => buildFreeformDerivedTarget(row, pageIndex)),
  ];
}

function buildFeatureDerivedTarget(row: ProjectPageRow, pageIndex: ReturnType<typeof buildProjectPageIndex>): IndexTarget {
  const orderedPrds = sortRows(pageIndex.prdsByFeature.get(row.featureId ?? "") ?? []);
  const childPrdIds = new Set(orderedPrds.map((item) => item.prdId).filter(Boolean));
  const childSlices = pageIndex.taskHubRows.filter((item) => childPrdIds.has(item.parentPrd ?? ""));
  const planningRows = [...orderedPrds, ...childSlices];
  const relatedModules = pageIndex.moduleRows.filter((item) => planningRows.some((candidate) => rowsOverlap(item, candidate)));
  return buildTarget(row, rewriteRowSections(row, [
    { heading: "Included PRDs", lines: renderLinks(orderedPrds), insertBefore: "Cross Links" },
    { heading: "Child Slices", lines: renderLinks(childSlices), insertBefore: "Cross Links" },
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
  ]));
}

function buildPrdDerivedTarget(row: ProjectPageRow, pageIndex: ReturnType<typeof buildProjectPageIndex>): IndexTarget {
  const taskHubRows = pageIndex.taskHubsByPrd.get(row.prdId ?? "") ?? [];
  const relatedModules = pageIndex.moduleRows.filter((item) => [row, ...taskHubRows].some((candidate) => rowsOverlap(item, candidate)));
  const featureRow = row.parentFeature ? pageIndex.featureMap.get(row.parentFeature) : undefined;
  return buildTarget(row, rewriteRowSections(row, [
    { heading: "Parent Feature", lines: featureRow ? [linkLine(featureRow)] : ["- none"] },
    { heading: "Child Slices", lines: renderLinks(taskHubRows), insertBefore: "Cross Links" },
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
  ]));
}

function buildSliceDerivedTarget(row: ProjectPageRow, pageIndex: ReturnType<typeof buildProjectPageIndex>): IndexTarget {
  const prdRow = row.parentPrd ? pageIndex.prdMap.get(row.parentPrd) : undefined;
  const featureRow = row.parentFeature ? pageIndex.featureMap.get(row.parentFeature) : undefined;
  const relatedModules = pageIndex.moduleRows.filter((item) => rowsOverlap(item, row));
  return buildTarget(row, rewriteRowSections(row, [
    { heading: "Parent PRD", lines: prdRow ? [linkLine(prdRow)] : ["- none"] },
    { heading: "Parent Feature", lines: featureRow ? [linkLine(featureRow)] : ["- none"], insertBefore: row.rel.endsWith("index.md") ? "Documents" : "Task" },
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
  ]));
}

function buildModuleDerivedTarget(row: ProjectPageRow, pageIndex: ReturnType<typeof buildProjectPageIndex>): IndexTarget {
  const relatedPrds = pageIndex.prdRows.filter((item) => rowsOverlap(row, item));
  const relatedSlices = pageIndex.taskHubRows.filter((item) => rowsOverlap(row, item));
  const relatedFeatures = relatedFeaturesFor(pageIndex.featureRows, relatedPrds, relatedSlices);
  return buildTarget(row, rewriteRowSections(row, [{
    heading: "Related Planning",
    lines: relatedPlanningLines(relatedFeatures, relatedPrds, relatedSlices),
    insertBefore: "Cross Links",
  }]));
}

function buildFreeformDerivedTarget(row: ProjectPageRow, pageIndex: ReturnType<typeof buildProjectPageIndex>): IndexTarget {
  const relatedModules = pageIndex.moduleRows.filter((item) => rowsOverlap(row, item));
  const relatedPrds = pageIndex.prdRows.filter((item) => rowsOverlap(row, item));
  const relatedSlices = pageIndex.taskHubRows.filter((item) => rowsOverlap(row, item));
  const relatedFeatures = relatedFeaturesFor(pageIndex.featureRows, relatedPrds, relatedSlices);
  return buildTarget(row, rewriteRowSections(row, [
    { heading: "Related Modules", lines: renderLinks(relatedModules), insertBefore: "Cross Links" },
    { heading: "Related Planning", lines: relatedPlanningLines(relatedFeatures, relatedPrds, relatedSlices), insertBefore: "Cross Links" },
  ]));
}

function buildProjectOverviewIndexTarget(project: string, pageRows: ProjectPageRow[]): IndexTarget {
  const sections = new Map<string, SectionEntry[]>();
  for (const row of pageRows) {
    if (row.section === "specs" && row.skipProjectIndex) continue;
    const lines = sections.get(row.section) ?? [];
    lines.push({ line: linkLine(row), sortKey: row.sortKey, specGroup: row.specGroup });
    sections.set(row.section, lines);
  }

  const featuresView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "features")).replace(/\.md$/u, "").replaceAll("\\", "/");
  const prdsView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "prds")).replace(/\.md$/u, "").replaceAll("\\", "/");
  const slicesView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "slices")).replace(/\.md$/u, "").replaceAll("\\", "/");
  const archiveView = relative(VAULT_ROOT, projectSpecViewIndexPath(project, "archive")).replace(/\.md$/u, "").replaceAll("\\", "/");

  const out = [`# ${project} Index`, "", `- [[projects/${project}/_summary|${project} summary]]`, ""];
  for (const [section, lines] of [...sections.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`## ${section}`, "");
    if (section === "specs") {
      const features = sortSectionEntries(lines, "features");
      const prds = sortSectionEntries(lines, "prds");
      const taskHubs = sortSectionEntries(lines, "task-hubs");
      const plans = sortSectionEntries(lines, "plans");
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

function buildSpecFamilyIndexTarget(project: string, pageRows: ProjectPageRow[], taskHubSections: Map<string, string[]>, family: "features" | "prds" | "slices" | "archive"): IndexTarget {
  const familyPath = relative(VAULT_ROOT, projectSpecViewIndexPath(project, family)).replaceAll("\\", "/");
  const specsIndex = relative(VAULT_ROOT, projectSpecsIndexPath(project)).replace(/\.md$/u, "").replaceAll("\\", "/");

  if (family === "features") {
    const features = sortRows(pageRows.filter((row) => row.kind === "spec-feature")).map((row) => linkLine(row));
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
    const featureTitles = new Map(pageRows.filter((row) => row.kind === "spec-feature" && row.featureId).map((row) => [row.featureId!, row.title]));
    const prds = sortRows(pageRows.filter((row) => row.kind === "spec-prd"));
    const grouped = new Map<string, string[]>();
    for (const row of prds) {
      const parentFeature = row.parentFeature ?? "unscoped";
      const lines = grouped.get(parentFeature) ?? [];
      lines.push(linkLine(row));
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
      for (const featureId of [...grouped.keys()].sort()) out.push(`## ${featureTitles.get(featureId) ?? featureId}`, "", ...(grouped.get(featureId) ?? ["- none"]), "");
    }
    return { path: familyPath, content: `${out.join("\n")}\n` };
  }

  if (family === "slices") {
    const out = [
      `# ${project} Slices`,
      "",
      `- [[projects/${project}/_summary|${project} summary]]`,
      `- [[${specsIndex}|spec index]]`,
      `- [[projects/${project}/backlog|backlog]]`,
      "",
    ];
    for (const [heading, lines] of selectTaskHubSections(taskHubSections, ["In Progress", "Todo", "Backlog", "Done", "Cancelled"])) out.push(`## ${heading}`, "", ...(lines.length ? lines : ["- none"]), "");
    return { path: familyPath, content: `${out.join("\n")}\n` };
  }

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
  for (const [heading, lines] of selectTaskHubSections(taskHubSections, ["Done", "Cancelled"])) out.push(`## ${heading}`, "", ...(lines.length ? lines : ["- none"]), "");
  return { path: familyPath, content: `${out.join("\n")}\n` };
}

function buildTarget(row: ProjectPageRow, content: string): IndexTarget {
  return { path: relative(VAULT_ROOT, row.file).replaceAll("\\", "/"), content };
}

function sortRows(rows: ProjectPageRow[]) {
  return [...rows].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function sortSectionEntries(lines: SectionEntry[], group: SpecIndexGroup) {
  return lines.filter((entry) => entry.specGroup === group).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
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
    source_paths: [
      "src/commands/index-log.ts",
      "src/commands/index-log-relationships.ts",
      "src/commands/index-log-markdown.ts",
      "src/lib/structure.ts",
      "src/commands/backlog.ts",
    ],
    updated: nowIso(),
    status: "current",
    verification_level: "code-verified",
  }, ["title", "type", "project", "source_paths", "updated", "status", "verification_level"]);
}
