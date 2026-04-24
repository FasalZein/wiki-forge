import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, safeMatter, writeNormalizedPage } from "../../cli-shared";
import {
  DEFAULT_SLICE_GREEN_CRITERIA,
  DEFAULT_SLICE_REFACTOR_CHECKS,
  SLICE_VERTICAL_STEP_PLACEHOLDER,
  hasSliceDocScaffoldPlaceholders,
} from "../../lib/slices/placeholders";
import { exists, readText } from "../../lib/fs";
import { projectPrdsDir, projectTaskPlanPath, projectTaskTestPlanPath } from "../../lib/structure";
import { resolveRepoPath } from "../../lib/verification";
import { collectBacklogView, type BacklogTaskContext } from "../../hierarchy";
import { collectForgeStatus } from "../../protocol";
import { escapeRegex, extractSection, readMatter, readPlanningDoc } from "./docs";
import { printError, printJson } from "../../lib/cli-output";

export type SlicePromptData = {
  sliceId: string;
  project: string;
  title: string;
  repo: string;
  planPath: string;
  testPlanPath: string;
  planSummary: string;
  testPlanSummary: string;
  commands: string[];
};

export async function buildSlicePromptData(
  project: string,
  sliceId: string,
  workflow: Awaited<ReturnType<typeof collectForgeStatus>>,
  active: boolean,
): Promise<SlicePromptData> {
  const title = typeof workflow.context?.title === "string" ? workflow.context.title : sliceId;
  const planPath = projectTaskPlanPath(project, sliceId);
  const testPlanPath = projectTaskTestPlanPath(project, sliceId);
  const [planDoc, testPlanDoc, repo] = await Promise.all([
    readMatter(planPath),
    readMatter(testPlanPath),
    resolveRepoPath(project).catch(() => "<repo-path>"),
  ]);
  const planSummary = compactDocSummary(planDoc?.content ?? "", ["Scope", "Acceptance Criteria"]);
  const testPlanSummary = compactDocSummary(testPlanDoc?.content ?? "", ["Red Tests", "Verification Commands"]);
  const commands: string[] = [
    `wiki forge ${active ? "run" : "start"} ${project} ${sliceId} --repo ${repo}`,
  ];
  return { sliceId, project, title, repo, planPath, testPlanPath, planSummary, testPlanSummary, commands };
}

export function renderSlicePrompt(data: SlicePromptData): string {
  const lines: string[] = [
    `Implement slice ${data.sliceId} for project ${data.project}.`,
    "",
    `Repo: ${data.repo}`,
    `Slice: ${data.sliceId} — ${data.title}`,
    `Plan: ${data.planSummary ? data.planSummary.split("\n")[0] : "(no plan summary)"}`,
    `Test Plan: ${data.testPlanSummary ? data.testPlanSummary.split("\n")[0] : "(no test plan summary)"}`,
    "",
    "Steps:",
    `1. Read the full plan at ${data.planPath}`,
    `2. Read the test plan at ${data.testPlanPath}`,
    "3. Implement using /tdd",
    ...data.commands.map((cmd, i) => `${i + 4}. Run: ${cmd}`),
  ];
  return lines.join("\n");
}

export async function forgeNextAll(project: string): Promise<void> {
  const view = await collectBacklogView(project);
  const inProgressTasks = ((view.sections["In Progress"] ?? []) as BacklogTaskContext[]).filter((task) => task.taskHubPath !== undefined);
  const todoTasks = ((view.sections["Todo"] ?? []) as BacklogTaskContext[]).filter((task) => task.taskHubPath !== undefined && task.blockedBy.length === 0);

  const inProgressEntries = inProgressTasks.map((task) => ({ task, active: true }));
  const todoEntries = todoTasks.map((task) => ({ task, active: false }));
  const candidates = [...inProgressEntries, ...todoEntries];

  if (!candidates.length) {
    printJson([]);
    return;
  }

  const results = await Promise.all(
    candidates.map(async ({ task, active }) => {
      const workflow = await collectForgeStatus(project, task.id);
      return buildSlicePromptData(project, task.id, workflow, active);
    }),
  );
  printJson(results);
}

export async function autoFillSliceDocs(project: string, sliceId: string, prdId: string): Promise<void> {
  const prdDoc = await readPlanningDoc(projectPrdsDir(project), prdId);
  if (!prdDoc) {
    printError(`[warn] PRD ${prdId} not found; skipping auto-fill for ${sliceId}`);
    return;
  }

  const goals = extractSection(prdDoc.content, "Goals");
  const userStories = extractSection(prdDoc.content, "User Stories");
  const acceptance = extractSection(prdDoc.content, "Acceptance Criteria");
  const problem = extractSection(prdDoc.content, "Problem");

  const prdTitle = typeof prdDoc.data.title === "string" ? prdDoc.data.title.trim() : prdId;
  const scopeBody = problem.trim()
    ? `- ${prdTitle}: ${problem.split("\n").find((line) => line.trim()) ?? problem.trim()}`
    : `- ${prdTitle}`;

  let criteriaLines: string[] = [];
  if (acceptance.trim()) {
    criteriaLines = acceptance.split("\n").filter((line) => line.trim());
  } else if (userStories.trim()) {
    criteriaLines = userStories
      .split("\n")
      .filter((line) => /^-\s+/u.test(line.trim()))
      .map((line) => `- [ ] ${line.replace(/^-\s*/u, "").trim()}`);
  } else if (goals.trim()) {
    criteriaLines = goals
      .split("\n")
      .filter((line) => /^-\s+/u.test(line.trim()))
      .map((line) => `- [ ] ${line.replace(/^-\s*/u, "").trim()}`);
  }

  if (!criteriaLines.length) criteriaLines = [`- [ ] implement requirements from ${prdTitle}`];

  const stepCount = Math.min(Math.max(criteriaLines.length, 3), 5);
  const verticalSliceLines = Array.from({ length: stepCount }, (_, i) => `${i + 1}. ${SLICE_VERTICAL_STEP_PLACEHOLDER}`);
  const redTestLines = criteriaLines.map((line) => {
    const text = line.replace(/^-\s*\[[ x]\]\s*/u, "").replace(/^-\s*/u, "").trim();
    return `- [ ] ${text}`;
  });

  await fillPlanDoc(project, sliceId, scopeBody, verticalSliceLines, criteriaLines);
  await fillTestPlanDoc(project, sliceId, redTestLines);
}

function extractSectionFuzzy(markdown: string, keyword: string): string {
  const pattern = new RegExp(`^##[^#].*${escapeRegex(keyword)}.*\\n([\\s\\S]*?)(?=^##\\s|$)`, "imu");
  const match = markdown.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function compactDocSummary(content: string, sections: string[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    let extracted = extractSection(content, section).trim();
    if (!extracted) extracted = extractSectionFuzzy(content, section).trim();
    if (!extracted) continue;
    const sectionLines = extracted.split("\n").filter((line: string) => line.trim()).slice(0, 5);
    lines.push(`${section}: ${sectionLines.join(" | ")}`);
  }
  if (lines.length > 0) return lines.join("\n");
  const bodyLines = content
    .split("\n")
    .filter((line: string) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !/^#{1,6}\s/u.test(trimmed) && !/^-\s*(?:\[[ x]\])?\s*$/u.test(trimmed);
    })
    .slice(0, 3);
  return bodyLines.length > 0 ? bodyLines.join(" | ") : "(empty)";
}

async function fillPlanDoc(project: string, sliceId: string, scopeBody: string, verticalSliceLines: string[], criteriaLines: string[]): Promise<void> {
  const planPath = projectTaskPlanPath(project, sliceId);
  const raw = await readText(planPath);
  const parsed = safeMatter(relative(VAULT_ROOT, planPath), raw, { silent: true });
  if (!parsed) return;

  let content = parsed.content;
  content = replaceSection(content, "Scope", scopeBody);
  content = replaceSection(content, "Vertical Slice", verticalSliceLines.join("\n"));
  content = replaceSection(content, "Acceptance Criteria", criteriaLines.join("\n"));

  writeNormalizedPage(planPath, content, {
    ...parsed.data,
    status: hasSliceDocScaffoldPlaceholders("plan", content) ? "draft" : "ready",
    updated: nowIso(),
  });
}

async function fillTestPlanDoc(project: string, sliceId: string, redTestLines: string[]): Promise<void> {
  const testPlanPath = projectTaskTestPlanPath(project, sliceId);
  const raw = await readText(testPlanPath);
  const parsed = safeMatter(relative(VAULT_ROOT, testPlanPath), raw, { silent: true });
  if (!parsed) return;

  let content = parsed.content;
  content = replaceSection(content, "Red Tests", redTestLines.join("\n"));
  content = replaceSection(content, "Green Criteria", DEFAULT_SLICE_GREEN_CRITERIA.join("\n"));
  content = replaceSection(content, "Refactor Checks", DEFAULT_SLICE_REFACTOR_CHECKS.join("\n"));
  content = replaceSection(content, "Verification Commands", "```bash\nbun test\nnpx tsc --noEmit\n```");

  writeNormalizedPage(testPlanPath, content, {
    ...parsed.data,
    status: hasSliceDocScaffoldPlaceholders("test-plan", content) ? "draft" : "ready",
    updated: nowIso(),
  });
}

function replaceSection(markdown: string, heading: string, newBody: string): string {
  const headingMarker = `## ${heading}`;
  const sectionStart = markdown.indexOf(`\n${headingMarker}\n`);
  if (sectionStart === -1) return markdown;

  const bodyStart = sectionStart + headingMarker.length + 2;
  const nextHeading = markdown.indexOf("\n## ", bodyStart);
  const bodyEnd = nextHeading === -1 ? markdown.length : nextHeading;

  return markdown.slice(0, bodyStart) + `${newBody.trim()}\n\n` + markdown.slice(bodyEnd);
}
