import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../../constants";
import { projectRoot, safeMatter } from "../../../cli-shared";
import { readText, exists, listDirs } from "../../../lib/fs";
import { workspaceIndexPath, workspaceProjectsDashboardPath } from "../../../lib/structure";
import { collectBacklogFocus } from "../backlog/collect";
import { collectStatusRow, loadLintingSnapshot } from "../.././verification";
import { buildProjectPageIndex, collectProjectPageRows } from "./relationships";

export type IndexTarget = { path: string; content: string };

type WorkspaceProjectRow = {
  project: string;
  title: string;
  summaryLink: string;
  backlogLink: string;
  specsLink: string;
  status: string;
  statusOrder: number;
  focus: string;
  modules: number;
  pages: number;
  bound: number;
  unbound: number;
  stale: number;
  featureCount: number;
  prdCount: number;
  sliceCount: number;
};

export async function listWorkspaceProjects() {
  const projectsRoot = join(VAULT_ROOT, "projects");
  if (!await exists(projectsRoot)) return [];
  return listDirs(projectsRoot).sort();
}

export async function buildWorkspaceIndexTargets(projects: string[]): Promise<IndexTarget[]> {
  const workspaceRows = await collectWorkspaceProjectRows(projects);
  return [
    buildWorkspaceRootIndexTarget(workspaceRows),
    buildWorkspaceDashboardTarget(workspaceRows),
  ];
}

async function collectWorkspaceProjectRows(projects: string[]): Promise<WorkspaceProjectRow[]> {
  const rows = await Promise.all(projects.map(async (project) => {
    const summaryPath = join(projectRoot(project), "_summary.md");
    const summaryParsed = await exists(summaryPath)
      ? safeMatter(relative(VAULT_ROOT, summaryPath), await readText(summaryPath), { silent: true })
      : null;
    const lintingSnapshot = await loadLintingSnapshot(project);
    const [status, pageRows, focus] = await Promise.all([
      collectStatusRow(project, lintingSnapshot),
      collectProjectPageRows(project),
      readWorkspaceProjectFocus(project),
    ]);
    const pageIndex = buildProjectPageIndex(pageRows);
    let rawStatus: string;
    if (typeof summaryParsed?.data.status === "string") {
      rawStatus = summaryParsed.data.status;
    } else {
      rawStatus = "unknown";
    }
    let title: string;
    if (typeof summaryParsed?.data.title === "string" && summaryParsed.data.title.trim()) {
      title = summaryParsed.data.title.trim();
    } else {
      title = project;
    }
    return {
      project,
      title,
      summaryLink: `projects/${project}/_summary`,
      backlogLink: `projects/${project}/backlog`,
      specsLink: `projects/${project}/specs/index`,
      status: humanizeStatus(rawStatus),
      statusOrder: workspaceStatusOrder(rawStatus),
      focus,
      modules: status.modules,
      pages: status.pages,
      bound: status.bound,
      unbound: status.unbound,
      stale: status.stale,
      featureCount: pageIndex.featureRows.length,
      prdCount: pageIndex.prdRows.length,
      sliceCount: pageIndex.taskHubRows.length,
    } satisfies WorkspaceProjectRow;
  }));
  return rows.sort((left, right) => left.statusOrder - right.statusOrder || left.title.localeCompare(right.title));
}

async function readWorkspaceProjectFocus(project: string) {
  try {
    const focus = await collectBacklogFocus(project);
    if (focus.activeTask) return `${focus.activeTask.id} ${focus.activeTask.title}`;
    if (focus.recommendedTask) return `next: ${focus.recommendedTask.id} ${focus.recommendedTask.title}`;
  } catch {}
  return "none";
}

function buildWorkspaceRootIndexTarget(projects: WorkspaceProjectRow[]): IndexTarget {
  const dashboardLink = relative(VAULT_ROOT, workspaceProjectsDashboardPath()).replace(/\.md$/u, "").replaceAll("\\", "/");
  const out = [
    "# Index",
    "",
    "## Workspace",
    "",
    `- [[${dashboardLink}|Project Dashboard]]`,
    "",
    "## Projects",
    "",
    "| Project | Status | Focus |",
    "|---------|--------|-------|",
    ...(projects.length
      ? projects.map((project) => `| [[${project.summaryLink}|${escapeTableCell(project.title)}]] | ${escapeTableCell(project.status)} | ${escapeTableCell(project.focus)} |`)
      : ["| (none onboarded yet) |  |  |"]),
    "",
  ];
  return { path: relative(VAULT_ROOT, workspaceIndexPath()).replaceAll("\\", "/"), content: `${out.join("\n")}\n` };
}

function buildWorkspaceDashboardTarget(projects: WorkspaceProjectRow[]): IndexTarget {
  const out = [
    "# Project Dashboard",
    "",
    "> [!summary]",
    "> Generated from the current workspace project corpus. Refresh via `wiki update-index --all --write` or any project index write path.",
    "",
    "## Projects",
    "",
    "| Project | Status | Focus | Coverage |",
    "|---------|--------|-------|----------|",
    ...(projects.length
      ? projects.map((project) => `| [[${project.summaryLink}|${escapeTableCell(project.title)}]] · [[${project.backlogLink}|backlog]] · [[${project.specsLink}|specs]] | ${escapeTableCell(project.status)} | ${escapeTableCell(project.focus)} | ${escapeTableCell(renderWorkspaceCoverage(project))} |`)
      : ["| (none onboarded yet) |  |  |  |"]),
    "",
  ];
  return { path: relative(VAULT_ROOT, workspaceProjectsDashboardPath()).replaceAll("\\", "/"), content: `${out.join("\n")}\n` };
}

function renderWorkspaceCoverage(project: WorkspaceProjectRow) {
  return `${project.modules} modules, ${project.pages} pages, ${project.featureCount}F/${project.prdCount}P/${project.sliceCount}S, ${project.stale} stale, ${project.unbound} unbound`;
}

function workspaceStatusOrder(status: string) {
  return new Map([
    ["current", 0],
    ["active", 0],
    ["scaffold", 1],
    ["paused", 2],
    ["completed", 3],
    ["archived", 4],
  ]).get(status.trim().toLowerCase()) ?? 9;
}

function humanizeStatus(status: string) {
  return status
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase()) || "Unknown";
}

function escapeTableCell(value: string) {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ").trim();
}
