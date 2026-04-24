import { parseProjectRepoBaseArgs } from "../../git-utils";
import { tailLog } from "../../lib/log";
import { loadLintingSnapshot, collectStatusRow, collectVerifySummary } from "../../verification";
import { collectDriftSummary } from "../drift";
import { loadProjectSnapshot } from "../shared";
import { collectMaintenancePlan } from "../closeout/maintain";
import { printJson } from "../../lib/cli-output";

export async function dashboardProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const raw = await collectDashboard(options.project, options.base, options.repo);
  printJson(compactDashboardForJson(raw));
}

export async function collectDashboard(project: string, base: string, explicitRepo?: string) {
  const [projectSnapshot, lintingSnapshot] = await Promise.all([
    loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true }),
    loadLintingSnapshot(project, { noteIndex: true }),
  ]);
  const maintain = await collectMaintenancePlan(project, base, explicitRepo, projectSnapshot, lintingSnapshot);
  const [status, verify, drift] = await Promise.all([
    collectStatusRow(project, lintingSnapshot),
    collectVerifySummary(project, lintingSnapshot),
    collectDriftSummary(project, explicitRepo, lintingSnapshot),
  ]);
  return { project, repo: maintain.repo, base, status, verify, drift, discover: maintain.discover, maintain, recentLog: await tailLog(20) };
}

export function compactDashboardForJson(result: Awaited<ReturnType<typeof collectDashboard>>) {
  const MAX_DRIFT_ROWS = 30;
  const MAX_IMPACTED = 25;
  const MAX_LOG = 15;
  const MAX_UNCOVERED = 50;
  const driftedRows = result.drift.results.filter((row) => row.status !== "fresh");
  const truncatedDrift = driftedRows.length > MAX_DRIFT_ROWS;
  return {
    ...result,
    drift: {
      ...result.drift,
      results: driftedRows.slice(0, MAX_DRIFT_ROWS).map(({ absolutePath, sourcePaths, driftedSources, renamedSources, deletedSources, ...row }) => ({
        ...row,
        sourcePathCount: sourcePaths?.length ?? 0,
        driftedSourceCount: driftedSources?.length ?? 0,
        renamedSourceCount: renamedSources?.length ?? 0,
        deletedSourceCount: deletedSources?.length ?? 0,
      })),
      ...(truncatedDrift ? { truncated: true, totalDrifted: driftedRows.length } : {}),
    },
    maintain: {
      ...result.maintain,
      refreshFromGit: {
        ...result.maintain.refreshFromGit,
        changedFiles: result.maintain.refreshFromGit.changedFiles?.slice(0, MAX_IMPACTED),
        ...(result.maintain.refreshFromGit.changedFiles && result.maintain.refreshFromGit.changedFiles.length > MAX_IMPACTED
          ? { changedFilesTruncated: true, totalChangedFiles: result.maintain.refreshFromGit.changedFiles.length }
          : {}),
        impactedPages: result.maintain.refreshFromGit.impactedPages?.slice(0, MAX_IMPACTED),
        ...(result.maintain.refreshFromGit.impactedPages
          ? { diffSummaryTruncated: result.maintain.refreshFromGit.impactedPages.length > MAX_IMPACTED }
          : {}),
      },
      discover: {
        ...result.maintain.discover,
        uncoveredFiles: result.maintain.discover.uncoveredFiles.slice(0, MAX_UNCOVERED),
        ...(result.maintain.discover.uncoveredFiles.length > MAX_UNCOVERED ? { uncoveredTruncated: true, totalUncovered: result.maintain.discover.uncoveredFiles.length } : {}),
      },
    },
    recentLog: result.recentLog.slice(0, MAX_LOG),
  };
}
