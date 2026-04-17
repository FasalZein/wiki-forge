import { parseProjectRepoBaseArgs } from "../git-utils";
import { tailLog } from "../lib/log";
import { loadLintingSnapshot, collectStatusRow, collectVerifySummary } from "../verification";
import { collectDriftSummary } from "../lib/drift-query";
import { loadProjectSnapshot } from "./_shared";
import { collectMaintenancePlan } from "./maintain";

export async function dashboardProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  console.log(JSON.stringify(await collectDashboard(options.project, options.base, options.repo), null, 2));
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
