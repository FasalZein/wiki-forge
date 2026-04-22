import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import {
  isCanonicalFeatureId,
  projectFeaturePath,
  projectFeaturesDir,
  projectPlanPath,
  projectPrdPath,
  projectPrdsDir,
  projectSpecsDir,
  projectTestPlanPath,
} from "../../lib/structure";
import { writeProjectIndex } from "../projection/index-log";

type PlanningKind = "feature" | "prd" | "plan" | "test-plan";
type IndexedPlanningKind = Extract<PlanningKind, "feature" | "prd">;
type SimplePlanningKind = Extract<PlanningKind, "plan" | "test-plan">;

type CreateSpecOptions = {
  featureId?: string;
  prdId?: string;
  parentFeature?: string;
  taskId?: string;
  supersedes?: string;
  splitFrom?: string;
  extraTemplateValues?: Record<string, string>;
};

const FEATURE_TEMPLATE = [
  "# {{display_title}}",
  "",
  "> [!summary]",
  "> Canonical feature hub for this planning area. Group related PRDs here so scope stays mechanical for humans and agents.",
  "",
  "## Problem",
  "",
  "What product/problem area does this feature own?",
  "",
  "## Outcome",
  "",
  "- ",
  "",
  "## Included PRDs",
  "",
  "- ",
  "",
  "## Non-Goals",
  "",
  "- ",
  "",
  "## Cross Links",
  "",
  "- [[projects/{{project}}/_summary]]",
  "- [[projects/{{project}}/backlog]]",
  "- [[projects/{{project}}/specs/index]]",
  "- [[projects/{{project}}/specs/prds/index]]",
] as const;

const PRD_TEMPLATE = [
  "# {{display_title}}",
  "",
  "> [!summary]",
  "> Canonical PRD for this change. Keep this note aligned with [[projects/{{project}}/_summary]], its parent feature, and linked research before implementation.",
  "",
  "## Parent Feature",
  "",
  "- [[{{feature_link}}|{{feature_title}}]]",
  "",
  "## Problem",
  "",
  "What problem are we solving?",
  "",
  "## Goals",
  "",
  "- ",
  "",
  "## Non-Goals",
  "",
  "- ",
  "",
  "## Users / Actors",
  "",
  "- ",
  "",
  "## User Stories",
  "",
  "- As a ..., I want ..., so that ...",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] ",
  "",
  "## Prior Research",
  "",
  "- Add topic-first research links here, e.g. `[[research/auth/_overview]]`.",
  "- For project-bound research, use `wiki research file <topic> --project {{project}} <title>` before linking the note here.",
  "",
  "## Open Questions",
  "",
  "- ",
  "",
  "## Cross Links",
  "",
  "- [[projects/{{project}}/_summary]]",
  "- [[projects/{{project}}/backlog]]",
  "- [[projects/{{project}}/specs/index]]",
  "- [[projects/{{project}}/specs/prds/index]]",
  "- [[{{feature_link}}|{{feature_title}}]]",
] as const;

const PLAN_TEMPLATE = [
  "# {{title}}",
  "",
  "> [!summary]",
  "> Execution plan for this slice. Keep steps small, testable, and linked back to the project hub.",
  "",
  "## Scope",
  "",
  "What is included in this implementation slice?",
  "",
  "## Assumptions",
  "",
  "- ",
  "",
  "## Work Breakdown",
  "",
  "1. ",
  "2. ",
  "3. ",
  "",
  "## Risks",
  "",
  "- ",
  "",
  "## Dependencies",
  "",
  "- ",
  "",
  "## Verification Strategy",
  "",
  "- unit:",
  "- integration:",
  "- manual:",
  "",
  "## Cross Links",
  "",
  "- [[projects/{{project}}/_summary]]",
  "- [[projects/{{project}}/backlog]]",
  "- [[projects/{{project}}/specs/index]]",
] as const;

const TEST_PLAN_TEMPLATE = [
  "# {{title}}",
  "",
  "> [!summary]",
  "> Test-first checklist for this change. Record red, green, and blind spots explicitly.",
  "",
  "## Scope Under Test",
  "",
  "- ",
  "",
  "## Test Cases",
  "",
  "- [ ] happy path",
  "- [ ] failure path",
  "- [ ] edge case",
  "",
  "## Fixtures / Data",
  "",
  "- ",
  "",
  "## Test Layers",
  "",
  "- unit:",
  "- integration:",
  "- e2e/manual:",
  "",
  "## Risks / Blind Spots",
  "",
  "- ",
  "",
  "## Verification Commands",
  "",
  "```bash",
  "# add one or more repo-root commands to run during verification",
  "```",
  "",
  "## Cross Links",
  "",
  "- [[projects/{{project}}/_summary]]",
  "- [[projects/{{project}}/verification/coverage]]",
  "- [[projects/{{project}}/specs/index]]",
] as const;

const SPEC_IDENTITY = {
  feature: { field: "feature_id", prefix: "FEAT", dir: projectFeaturesDir },
  prd: { field: "prd_id", prefix: "PRD", dir: projectPrdsDir },
} as const;

export async function createFeature(args: string[]) {
  const { project, name } = parseProjectAndName(args);
  const { path } = await createIndexedSpecDocument(project, "feature", name, FEATURE_TEMPLATE);
  announceCreated(path);
}

export async function createPrd(args: string[]) {
  const options = parsePrdArgs(args);
  const feature = await resolveFeatureRecord(options.project, options.featureId);
  const { path } = await createIndexedSpecDocument(options.project, "prd", options.name, PRD_TEMPLATE, {
    parentFeature: feature.featureId,
    supersedes: options.supersedes,
    splitFrom: options.splitFrom,
    extraTemplateValues: {
      feature_link: feature.linkPath,
      feature_title: feature.title,
    },
  });
  announceCreated(path);
}

export async function createFeatureReturningId(project: string, name: string): Promise<{ specId: string; path: string }> {
  return createIndexedSpecDocument(project, "feature", name, FEATURE_TEMPLATE);
}

export async function createPrdReturningId(project: string, name: string, featureId: string, supersedes?: string, splitFrom?: string): Promise<{ specId: string; path: string }> {
  const feature = await resolveFeatureRecord(project, featureId);
  return createIndexedSpecDocument(project, "prd", name, PRD_TEMPLATE, {
    parentFeature: feature.featureId,
    supersedes,
    splitFrom,
    extraTemplateValues: {
      feature_link: feature.linkPath,
      feature_title: feature.title,
    },
  });
}

export async function createPlan(args: string[]) {
  announceCreated(await createSimpleSpecDocument(args, "plan", PLAN_TEMPLATE));
}

export async function createTestPlan(args: string[]) {
  announceCreated(await createSimpleSpecDocument(args, "test-plan", TEST_PLAN_TEMPLATE));
}

async function createIndexedSpecDocument(project: string, kind: IndexedPlanningKind, name: string, templateLines: readonly string[], options: CreateSpecOptions = {}) {
  const specId = await nextSpecId(project, kind);
  const outputPath = await createSpecDocumentInternal(project, kind, name, templateLines, kind === "feature" ? { ...options, featureId: specId } : { ...options, prdId: specId });
  await writeProjectIndex(project);
  return { specId, path: outputPath };
}

export async function createSpecDocumentInternal(project: string, kind: PlanningKind, name: string, templateLines: readonly string[], options: CreateSpecOptions = {}) {
  const slug = slugify(name);
  await mkdirIfMissing(projectSpecsDir(project));
  await ensureKindDirectory(project, kind);
  const displayTitle = buildDisplayTitle(kind, name, options);
  const outputPath = resolveOutputPath(project, kind, slug, options);
  if (await exists(outputPath)) throw new Error(`spec already exists: ${relative(VAULT_ROOT, outputPath)}`);
  writeNormalizedPage(outputPath, interpolateTemplate(templateLines.join("\n"), buildTemplateValues(project, name, displayTitle, options)), buildSpecFrontmatter(project, kind, displayTitle, options));
  return outputPath;
}

async function createSimpleSpecDocument(args: string[], kind: SimplePlanningKind, templateLines: readonly string[]) {
  const { project, name } = parseProjectAndName(args);
  const outputPath = await createSpecDocumentInternal(project, kind, name, templateLines);
  await writeProjectIndex(project);
  return outputPath;
}

function parseFeatureArgs(args: string[]) {
  return parseProjectAndName(args);
}

export function parsePrdArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let supersedes: string | undefined;
  let splitFrom: string | undefined;
  const nameParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--feature":
        featureId = args[index + 1];
        index += 1;
        break;
      case "--supersedes":
        supersedes = args[index + 1];
        index += 1;
        break;
      case "--split-from":
        splitFrom = args[index + 1];
        index += 1;
        break;
      default:
        if (!arg.startsWith("--")) nameParts.push(arg);
        break;
    }
  }
  const name = nameParts.join(" ").trim();
  requireValue(featureId, "feature-id (--feature FEAT-001)");
  requireValue(name || undefined, "name");
  return { project, name, featureId, supersedes, splitFrom };
}

async function nextSpecId(project: string, kind: IndexedPlanningKind) {
  const { field, prefix, dir: resolveDir } = SPEC_IDENTITY[kind];
  const dir = resolveDir(project);
  if (!await exists(dir)) return `${prefix}-001`;
  const filePattern = new RegExp(`^${prefix}-(\\d{3,})-`, "u");
  const frontmatterPattern = new RegExp(`^${prefix}-(\\d{3,})$`, "u");
  let max = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    max = Math.max(max, parseOrdinal(entry, filePattern));
    const file = `${dir}/${entry}`;
    const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
    let fromFrontmatter: string;
    if (typeof parsed?.data[field] === "string") {
      fromFrontmatter = parsed.data[field] as string;
    } else {
      fromFrontmatter = "";
    }
    max = Math.max(max, parseOrdinal(fromFrontmatter, frontmatterPattern));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

async function resolveFeatureRecord(project: string, featureId: string) {
  if (!isCanonicalFeatureId(featureId)) throw new Error(`invalid feature id: ${featureId}`);
  const dir = projectFeaturesDir(project);
  if (!await exists(dir)) throw new Error(`feature not found: ${featureId}`);
  const fileName = readdirSync(dir).find((entry) => entry.startsWith(`${featureId}-`) && entry.endsWith(".md"));
  if (!fileName) throw new Error(`feature not found: ${featureId}`);
  const file = `${dir}/${fileName}`;
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  let title: string;
  if (typeof parsed?.data.title === "string" && parsed.data.title.trim()) {
    title = parsed.data.title.trim();
  } else {
    title = featureId;
  }
  return { featureId, title, linkPath: relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/") };
}

function announceCreated(outputPath: string) {
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export function parseProjectAndName(args: string[]) {
  const project = args[0];
  const name = args.slice(1).filter(a => !a.startsWith("--")).join(" ").trim();
  requireValue(project, "project");
  requireValue(name || undefined, "name");
  return { project, name };
}

async function ensureKindDirectory(project: string, kind: PlanningKind) {
  if (kind === "feature") await mkdirIfMissing(projectFeaturesDir(project));
  if (kind === "prd") await mkdirIfMissing(projectPrdsDir(project));
}

function buildDisplayTitle(kind: PlanningKind, name: string, options: CreateSpecOptions) {
  if (kind === "feature") return `${options.featureId} ${name.trim()}`;
  if (kind === "prd") return `${options.prdId} ${name.trim()}`;
  return name.trim();
}

function resolveOutputPath(project: string, kind: PlanningKind, slug: string, options: CreateSpecOptions) {
  if (kind === "feature") return projectFeaturePath(project, options.featureId!, slug);
  if (kind === "prd") return projectPrdPath(project, options.prdId!, slug);
  if (kind === "plan") return projectPlanPath(project, slug);
  return projectTestPlanPath(project, slug);
}

function buildSpecFrontmatter(project: string, kind: PlanningKind, displayTitle: string, options: CreateSpecOptions) {
  return orderFrontmatter({
    title: displayTitle,
    type: "spec",
    spec_kind: kind,
    project,
    ...(options.featureId ? { feature_id: options.featureId } : {}),
    ...(options.prdId ? { prd_id: options.prdId } : {}),
    ...(options.parentFeature ? { parent_feature: options.parentFeature } : {}),
    ...(options.taskId ? { task_id: options.taskId } : {}),
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
    ...(options.splitFrom ? { split_from: options.splitFrom } : {}),
    created_at: nowIso(),
    updated: nowIso(),
    status: "draft",
  }, ["title", "type", "spec_kind", "project", "feature_id", "prd_id", "parent_feature", "task_id", "supersedes", "split_from", "created_at", "updated", "status"]);
}

function buildTemplateValues(project: string, name: string, displayTitle: string, options: CreateSpecOptions) {
  return {
    title: name.trim(),
    display_title: displayTitle,
    project,
    taskId: options.taskId ?? "",
    featureId: options.featureId ?? "",
    prdId: options.prdId ?? "",
    parentFeature: options.parentFeature ?? "",
    ...options.extraTemplateValues,
  };
}

function parseOrdinal(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match ? Number.parseInt(match[1] || "0", 10) : 0;
}

function interpolateTemplate(template: string, values: Record<string, string>) {
  let result = template;
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{{${key}}}`, value);
  return result;
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "spec";
}
