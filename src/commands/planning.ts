import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { mkdirIfMissing, orderFrontmatter, projectRoot, requireValue, today, writeNormalizedPage } from "../cli-shared";

export function createPrd(args: string[]) {
  const outputPath = createSpecDocument(args, "prd", [
    "# {{title}}",
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
  ]);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export function createPlan(args: string[]) {
  const outputPath = createSpecDocument(args, "plan", [
    "# {{title}}",
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
  ]);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export function createTestPlan(args: string[]) {
  const outputPath = createSpecDocument(args, "test-plan", [
    "# {{title}}",
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
  ]);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export function createSpecDocumentInternal(project: string, kind: "prd" | "plan" | "test-plan", name: string, templateLines: string[], taskId?: string) {
  const slug = slugify(name);
  const title = name.trim();
  const specsDir = join(projectRoot(project), "specs");
  mkdirIfMissing(specsDir);
  const outputPath = join(specsDir, `${kind}-${slug}.md`);
  if (existsSync(outputPath)) throw new Error(`spec already exists: ${relative(VAULT_ROOT, outputPath)}`);
  const data = orderFrontmatter({
    title,
    type: "spec",
    spec_kind: kind,
    project,
    updated: today(),
    status: "draft",
    ...(taskId ? { task_id: taskId } : {}),
  }, ["title", "type", "spec_kind", "project", "task_id", "updated", "status"]);
  const body = templateLines.join("\n").replaceAll("{{title}}", title).replaceAll("{{project}}", project).replaceAll("{{taskId}}", taskId ?? "");
  writeNormalizedPage(outputPath, body, data);
  return outputPath;
}

function createSpecDocument(args: string[], kind: "prd" | "plan" | "test-plan", templateLines: string[]) {
  const project = args[0];
  const name = args.slice(1).join(" ").trim();
  requireValue(project, "project");
  requireValue(name || undefined, "name");
  return createSpecDocumentInternal(project, kind, name, templateLines);
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "spec";
}
