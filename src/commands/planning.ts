import { existsSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { createdAt, mkdirIfMissing, nowIso, orderFrontmatter, requireValue, writeNormalizedPage } from "../cli-shared";
import { projectPlanPath, projectPrdPath, projectSpecsDir, projectTestPlanPath } from "../lib/structure";
import { writeProjectIndex } from "./index-log";

export async function createPrd(args: string[]) {
  const outputPath = await createSpecDocument(args, "prd", [
    "# {{title}}",
    "",
    "> [!summary]",
    "> Canonical PRD for this change. Keep this note aligned with [[projects/{{project}}/_summary]] and linked research before implementation.",
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
  ]);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export async function createPlan(args: string[]) {
  const outputPath = await createSpecDocument(args, "plan", [
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
  const outputPath = await createSpecDocument(args, "test-plan", [
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

export function createSpecDocumentInternal(project: string, kind: "prd" | "plan" | "test-plan", name: string, templateLines: string[], taskId?: string) {
  const slug = slugify(name);
  const title = name.trim();
  const specsDir = projectSpecsDir(project);
  mkdirIfMissing(specsDir);
  const outputPath = kind === "prd"
    ? projectPrdPath(project, slug)
    : kind === "plan"
      ? projectPlanPath(project, slug)
      : projectTestPlanPath(project, slug);
  if (existsSync(outputPath)) throw new Error(`spec already exists: ${relative(VAULT_ROOT, outputPath)}`);
  const data = orderFrontmatter({
    title,
    type: "spec",
    spec_kind: kind,
    project,
    created_at: nowIso(),
    updated: nowIso(),
    status: "draft",
    ...(taskId ? { task_id: taskId } : {}),
  }, ["title", "type", "spec_kind", "project", "task_id", "created_at", "updated", "status"]);
  const body = templateLines.join("\n").replaceAll("{{title}}", title).replaceAll("{{project}}", project).replaceAll("{{taskId}}", taskId ?? "");
  writeNormalizedPage(outputPath, body, data);
  return outputPath;
}

async function createSpecDocument(args: string[], kind: "prd" | "plan" | "test-plan", templateLines: string[]) {
  const project = args[0];
  const name = args.slice(1).join(" ").trim();
  requireValue(project, "project");
  requireValue(name || undefined, "name");
  const outputPath = createSpecDocumentInternal(project, kind, name, templateLines);
  await writeProjectIndex(project);
  return outputPath;
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "spec";
}
