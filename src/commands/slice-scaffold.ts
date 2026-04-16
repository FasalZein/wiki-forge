import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, mkdirIfMissing, nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { appendLogEntry } from "../lib/log";
import { isCanonicalPrdId, projectPrdsDir, projectTaskDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath, toVaultWikilinkPath } from "../lib/structure";
import { assertKnownAgent } from "../lib/agents";
import { exists } from "../lib/fs";
import { writeProjectIndex } from "./index-log";
import { appendTaskToBacklog, parseTaskArgs } from "./backlog-io";

type PrdRecord = { prdId: string; title: string; parentFeature?: string; linkPath: string; sourcePaths: string[] };
type SliceSpecKind = "task-hub" | "plan" | "test-plan";
type SlicePaths = { taskSpecsDir: string; indexPath: string; planPath: string; testPlanPath: string };

export async function createIssueSlice(args: string[]) {
  const options = parseTaskArgs(args);
  if (options.assignee) await assertKnownAgent(options.project, options.assignee);
  const prd = options.parentPrd ? await resolvePrdRecord(options.project, options.parentPrd) : null;
  if (!prd) {
    console.warn("[warn] no --prd provided; slice will be orphaned and excluded from hierarchy status");
  }
  const appended = await appendTaskToBacklog(options);
  const title = `${appended.taskId.toLowerCase()} ${options.title}`;
  const slicePaths = await createSlicePaths(options.project, appended.taskId);
  await ensureSliceDocsMissing(appended.taskId, slicePaths);
  const sourcePaths = options.sourcePaths.length ? options.sourcePaths : (prd?.sourcePaths ?? []);
  if (!options.sourcePaths.length && prd && prd.sourcePaths.length > 5) {
    console.warn(`warning: ${prd.prdId} has ${prd.sourcePaths.length} inherited source_paths; consider --source for a narrower slice binding`);
  }

  writeSliceSpec(
    slicePaths.indexPath,
    buildSliceIndexContent(options.project, appended.taskId, options.title, prd, slicePaths),
    buildSliceFrontmatter(`${appended.taskId} ${options.title}`, "task-hub", options.project, appended.taskId, prd, sourcePaths, options.assignee),
  );
  writeSliceSpec(
    slicePaths.planPath,
    buildSlicePlanContent(options.project, appended.taskId, title, prd, slicePaths),
    buildSliceFrontmatter(title, "plan", options.project, appended.taskId, prd, sourcePaths, options.assignee),
  );
  writeSliceSpec(
    slicePaths.testPlanPath,
    buildSliceTestPlanContent(options.project, appended.taskId, title, prd, slicePaths),
    buildSliceFrontmatter(title, "test-plan", options.project, appended.taskId, prd, sourcePaths, options.assignee),
  );

  await writeProjectIndex(options.project);
  appendLogEntry("create-issue-slice", options.title, {
    project: options.project,
    details: [
      `task=${appended.taskId}`,
      `hub=${relative(VAULT_ROOT, slicePaths.indexPath)}`,
      `plan=${relative(VAULT_ROOT, slicePaths.planPath)}`,
      `test=${relative(VAULT_ROOT, slicePaths.testPlanPath)}`,
    ],
  });
  const result = {
    project: options.project,
    taskId: appended.taskId,
    section: options.section,
    title: options.title,
    backlogPath: relative(VAULT_ROOT, appended.backlogPath),
    indexPath: relative(VAULT_ROOT, slicePaths.indexPath),
    planPath: relative(VAULT_ROOT, slicePaths.planPath),
    testPlanPath: relative(VAULT_ROOT, slicePaths.testPlanPath),
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`created issue slice ${appended.taskId}`);
    console.log(`- backlog: ${result.backlogPath}`);
    console.log(`- index: ${result.indexPath}`);
    console.log(`- plan: ${result.planPath}`);
    console.log(`- test-plan: ${result.testPlanPath}`);
  }
}

async function createSlicePaths(project: string, taskId: string): Promise<SlicePaths> {
  const taskSpecsDir = projectTaskDir(project, taskId);
  await mkdirIfMissing(taskSpecsDir);
  return {
    taskSpecsDir,
    indexPath: projectTaskHubPath(project, taskId),
    planPath: projectTaskPlanPath(project, taskId),
    testPlanPath: projectTaskTestPlanPath(project, taskId),
  };
}

async function ensureSliceDocsMissing(taskId: string, paths: SlicePaths) {
  if (await exists(paths.indexPath) || await exists(paths.planPath) || await exists(paths.testPlanPath)) {
    throw new Error(`slice docs already exist for ${taskId}: ${relative(VAULT_ROOT, paths.taskSpecsDir)}`);
  }
}

function parentPrdSection(prd: PrdRecord | null) {
  return prd ? ["## Parent PRD", "", `- [[${prd.linkPath}|${prd.title}]]`, ""] : [];
}

function buildSliceFrontmatter(title: string, specKind: SliceSpecKind, project: string, taskId: string, prd: PrdRecord | null, sourcePaths: string[], assignee?: string) {
  return orderFrontmatter({
    title,
    type: "spec",
    spec_kind: specKind,
    project,
    ...(sourcePaths.length ? { source_paths: sourcePaths } : {}),
    ...(assignee ? { assignee } : {}),
    task_id: taskId,
    ...(prd?.prdId ? { parent_prd: prd.prdId } : {}),
    ...(prd?.parentFeature ? { parent_feature: prd.parentFeature } : {}),
    created_at: nowIso(),
    updated: nowIso(),
    status: "draft",
  }, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"]);
}

function writeSliceSpec(path: string, content: string, frontmatter: Record<string, unknown>) {
  writeNormalizedPage(path, content, frontmatter);
}

function buildSliceIndexContent(project: string, taskId: string, title: string, prd: PrdRecord | null, paths: SlicePaths) {
  return [
    `# ${taskId} — ${title}`,
    "",
    "> [!summary]",
    `> Canonical hub for slice ${taskId}. Keep plan and test plan linked here so agents stay inside one bounded workspace.`,
    "> [!tip]",
    "> Add `depends_on` in frontmatter when this slice must wait for another slice to finish.",
    "",
    ...parentPrdSection(prd),
    "## Documents",
    "",
    `- [[${toVaultWikilinkPath(paths.planPath)}]]`,
    `- [[${toVaultWikilinkPath(paths.testPlanPath)}]]`,
    "",
    "## Cross Links",
    "",
    ...(prd ? [`- [[${prd.linkPath}|${prd.title}]]`] : []),
    `- [[projects/${project}/backlog]]`,
    `- [[projects/${project}/specs/index]]`,
    "",
  ].join("\n");
}

function buildSlicePlanContent(project: string, taskId: string, title: string, prd: PrdRecord | null, paths: SlicePaths) {
  return [
    `# ${title}`,
    "",
    "> [!summary]",
    `> Canonical execution plan for slice ${taskId}. Keep the slice vertical and independently verifiable.`,
    "",
    ...parentPrdSection(prd),
    "## Task",
    "",
    `- ID: ${taskId}`,
    "",
    "## Scope",
    "",
    "- ",
    "",
    "## Vertical Slice",
    "",
    "1. ",
    "2. ",
    "3. ",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] ",
    "",
    "## Cross Links",
    "",
    `- [[${toVaultWikilinkPath(paths.indexPath)}]]`,
    `- [[${toVaultWikilinkPath(paths.testPlanPath)}]]`,
    ...(prd ? [`- [[${prd.linkPath}|${prd.title}]]`] : []),
    `- [[projects/${project}/backlog]]`,
    `- [[projects/${project}/specs/index]]`,
    "",
  ].join("\n");
}

function buildSliceTestPlanContent(project: string, taskId: string, title: string, prd: PrdRecord | null, paths: SlicePaths) {
  return [
    `# ${title}`,
    "",
    "> [!summary]",
    `> Red-green-refactor checklist for slice ${taskId}.`,
    "",
    ...parentPrdSection(prd),
    "## Task",
    "",
    `- ID: ${taskId}`,
    "",
    "## Red Tests",
    "",
    "- [ ] ",
    "",
    "## Green Criteria",
    "",
    "- [ ] ",
    "",
    "## Refactor Checks",
    "",
    "- [ ] ",
    "",
    "## Verification Commands",
    "",
    "```bash",
    "# add one or more repo-root commands that prove this slice is done",
    "```",
    "",
    "## Cross Links",
    "",
    `- [[${toVaultWikilinkPath(paths.indexPath)}]]`,
    `- [[${toVaultWikilinkPath(paths.planPath)}]]`,
    ...(prd ? [`- [[${prd.linkPath}|${prd.title}]]`] : []),
    `- [[projects/${project}/backlog]]`,
    `- [[projects/${project}/specs/index]]`,
    "",
  ].join("\n");
}

async function resolvePrdRecord(project: string, prdId: string): Promise<PrdRecord> {
  if (!isCanonicalPrdId(prdId)) throw new Error(`invalid PRD id: ${prdId}`);
  const dir = projectPrdsDir(project);
  await assertExists(dir, `PRD not found: ${prdId}`);
  const fileName = readdirSync(dir).find((entry) => entry.startsWith(`${prdId}-`) && entry.endsWith(".md"));
  if (!fileName) throw new Error(`PRD not found: ${prdId}`);
  const file = join(dir, fileName);
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  const title = typeof parsed?.data.title === "string" && parsed.data.title.trim() ? parsed.data.title.trim() : prdId;
  const parentFeature = typeof parsed?.data.parent_feature === "string" ? parsed.data.parent_feature : undefined;
  const sourcePaths = Array.isArray(parsed?.data.source_paths) ? parsed.data.source_paths.map((value) => String(value).replaceAll("\\", "/")).filter(Boolean) : [];
  return { prdId, title, parentFeature, linkPath: toVaultWikilinkPath(file), sourcePaths };
}
