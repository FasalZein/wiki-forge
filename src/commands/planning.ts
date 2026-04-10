import { existsSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import {
  isCanonicalFeatureId,
  projectFeaturePath,
  projectFeaturesDir,
  projectPlanPath,
  projectPrdPath,
  projectPrdsDir,
  projectSpecsDir,
  projectTestPlanPath,
} from "../lib/structure";
import { writeProjectIndex } from "./index-log";

type PlanningKind = "feature" | "prd" | "plan" | "test-plan";

export async function createFeature(args: string[]) {
  const options = parseFeatureArgs(args);
  const featureId = await nextSpecId(options.project, "feature");
  const outputPath = createSpecDocumentInternal(options.project, "feature", options.name, [
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
  ], { featureId });
  await writeProjectIndex(options.project);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export async function createPrd(args: string[]) {
  const options = parsePrdArgs(args);
  const feature = await resolveFeatureRecord(options.project, options.featureId);
  const prdId = await nextSpecId(options.project, "prd");
  const outputPath = createSpecDocumentInternal(options.project, "prd", options.name, [
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
    "- [[research/projects/{{project}}/_overview]]",
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
  ], {
    prdId,
    parentFeature: feature.featureId,
    supersedes: options.supersedes,
    splitFrom: options.splitFrom,
    extraTemplateValues: {
      feature_link: feature.linkPath,
      feature_title: feature.title,
    },
  });
  await writeProjectIndex(options.project);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export async function createPlan(args: string[]) {
  const outputPath = await createSimpleSpecDocument(args, "plan", [
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
  ]);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export async function createTestPlan(args: string[]) {
  const outputPath = await createSimpleSpecDocument(args, "test-plan", [
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
    "## Cross Links",
    "",
    "- [[projects/{{project}}/_summary]]",
    "- [[projects/{{project}}/verification/coverage]]",
    "- [[projects/{{project}}/specs/index]]",
  ]);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

type CreateSpecOptions = {
  featureId?: string;
  prdId?: string;
  parentFeature?: string;
  taskId?: string;
  supersedes?: string;
  splitFrom?: string;
  extraTemplateValues?: Record<string, string>;
};

export function createSpecDocumentInternal(project: string, kind: PlanningKind, name: string, templateLines: string[], options: CreateSpecOptions = {}) {
  const slug = slugify(name);
  const specsDir = projectSpecsDir(project);
  mkdirIfMissing(specsDir);
  const displayTitle = kind === "feature"
    ? `${options.featureId} ${name.trim()}`
    : kind === "prd"
      ? `${options.prdId} ${name.trim()}`
      : name.trim();
  const outputPath = kind === "feature"
    ? projectFeaturePath(project, options.featureId!, slug)
    : kind === "prd"
      ? projectPrdPath(project, options.prdId!, slug)
      : kind === "plan"
        ? projectPlanPath(project, slug)
        : projectTestPlanPath(project, slug);
  if (kind === "feature") mkdirIfMissing(projectFeaturesDir(project));
  if (kind === "prd") mkdirIfMissing(projectPrdsDir(project));
  if (existsSync(outputPath)) throw new Error(`spec already exists: ${relative(VAULT_ROOT, outputPath)}`);
  const data = orderFrontmatter({
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
  const body = interpolateTemplate(templateLines.join("\n"), {
    title: name.trim(),
    display_title: displayTitle,
    project,
    taskId: options.taskId ?? "",
    featureId: options.featureId ?? "",
    prdId: options.prdId ?? "",
    parentFeature: options.parentFeature ?? "",
    ...options.extraTemplateValues,
  });
  writeNormalizedPage(outputPath, body, data);
  return outputPath;
}

async function createSimpleSpecDocument(args: string[], kind: "plan" | "test-plan", templateLines: string[]) {
  const project = args[0];
  const name = args.slice(1).join(" ").trim();
  requireValue(project, "project");
  requireValue(name || undefined, "name");
  const outputPath = createSpecDocumentInternal(project, kind, name, templateLines);
  await writeProjectIndex(project);
  return outputPath;
}

function parseFeatureArgs(args: string[]) {
  const project = args[0];
  const name = args.slice(1).join(" ").trim();
  requireValue(project, "project");
  requireValue(name || undefined, "name");
  return { project, name };
}

function parsePrdArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let supersedes: string | undefined;
  let splitFrom: string | undefined;
  const nameParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--feature") { featureId = args[index + 1]; index += 1; continue; }
    if (arg === "--supersedes") { supersedes = args[index + 1]; index += 1; continue; }
    if (arg === "--split-from") { splitFrom = args[index + 1]; index += 1; continue; }
    nameParts.push(arg);
  }
  const name = nameParts.join(" ").trim();
  requireValue(featureId, "feature-id (--feature FEAT-001)");
  requireValue(name || undefined, "name");
  return { project, name, featureId, supersedes, splitFrom };
}

async function nextSpecId(project: string, kind: "feature" | "prd") {
  const dir = kind === "feature" ? projectFeaturesDir(project) : projectPrdsDir(project);
  const field = kind === "feature" ? "feature_id" : "prd_id";
  const prefix = kind === "feature" ? "FEAT" : "PRD";
  if (!existsSync(dir)) return `${prefix}-001`;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const match = entry.match(new RegExp(`^${prefix}-(\\d{3,})-`, "u"));
    if (match) max = Math.max(max, Number.parseInt(match[1] || "0", 10));
    const file = `${dir}/${entry}`;
    const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
    const fromFrontmatter = typeof parsed?.data[field] === "string" ? parsed.data[field] : "";
    const frontmatterMatch = fromFrontmatter.match(new RegExp(`^${prefix}-(\\d{3,})$`, "u"));
    if (frontmatterMatch) max = Math.max(max, Number.parseInt(frontmatterMatch[1] || "0", 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

async function resolveFeatureRecord(project: string, featureId: string) {
  if (!isCanonicalFeatureId(featureId)) throw new Error(`invalid feature id: ${featureId}`);
  const dir = projectFeaturesDir(project);
  if (!existsSync(dir)) throw new Error(`feature not found: ${featureId}`);
  const fileName = readdirSync(dir).find((entry) => entry.startsWith(`${featureId}-`) && entry.endsWith(".md"));
  if (!fileName) throw new Error(`feature not found: ${featureId}`);
  const file = `${dir}/${fileName}`;
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  const title = typeof parsed?.data.title === "string" && parsed.data.title.trim() ? parsed.data.title.trim() : `${featureId}`;
  const linkPath = relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/");
  return { featureId, title, linkPath };
}

function interpolateTemplate(template: string, values: Record<string, string>) {
  let result = template;
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{{${key}}}`, value);
  return result;
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "spec";
}
