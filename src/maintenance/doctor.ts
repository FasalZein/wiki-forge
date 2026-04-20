import { formatMaintenanceActionLabel } from "../lib/diagnostics";
import { collectBacklog } from "../hierarchy";
import { readSliceSummary } from "../lib/slices";
import { collectLintResult, collectSemanticLintResult, collectStatusRow, collectVerifySummary, loadLintingSnapshot } from "../verification";
import type { LintingSnapshot } from "../verification";
import { parseProjectRepoBaseArgs } from "../git-utils";
import {
  loadProjectSnapshot,
  collectRefreshFromGit,
  collectRefreshFromWorktree,
  type ProjectSnapshot,
} from "./_shared";
import { collectDriftSummary } from "./drift";
import { collectMaintenancePlan } from "./maintain";

export async function doctorProject(args: string[]) {
  const { project, repo, base, baseFallbackNote } = await parseProjectRepoBaseArgs(args, {
    fallbackToHeadIfUnresolvable: true,
    fallbackLabel: "doctor",
  });
  const json = args.includes("--json");
  const worktree = args.includes("--worktree");
  if (baseFallbackNote) console.error(baseFallbackNote);
  const result = await collectDoctor(project, base, repo, { worktree });
  if (json) {
    console.log(JSON.stringify(compactDoctorForJson(result), null, 2));
    return;
  }

  const gateOk = result.counts.missingTests === 0;
  console.log(`doctor for ${project}:`);
  console.log(`- score: ${result.score}/100`);
  console.log(`- GATE: ${gateOk ? "PASS" : `FAIL — ${result.counts.missingTests} code file(s) without tests`}`);
  console.log(`- stale=${result.counts.stale} renamed=${result.counts.renamed} deleted=${result.counts.deleted} unbound=${result.counts.unbound}`);
  console.log(`- lint=${result.counts.lint} semantic=${result.counts.semantic} uncovered=${result.counts.uncovered} repo_docs=${result.counts.repoDocs} missing_tests=${result.counts.missingTests}`);
  console.log(`- task sections: ${Object.entries(result.backlog.sections).map(([k, v]) => `${k}=${v.length}`).join(" ")}`);
  if (result.focus.activeTask) console.log(`- active task: ${result.focus.activeTask.id} ${result.focus.activeTask.title} (plan=${result.focus.activeTask.planStatus} test-plan=${result.focus.activeTask.testPlanStatus})`);
  else if (result.focus.recommendedTask) console.log(`- next task: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
  if (result.backlogWarnings.length) {
    console.log(`- backlog warnings:`);
    for (const warning of result.backlogWarnings) console.log(`  - ${warning}`);
  }
  console.log(`- top actions:`);
  for (const action of result.topActions) console.log(`  - ${formatMaintenanceActionLabel(action)} ${action.message}`);
}

export async function collectDoctor(project: string, base: string, explicitRepo?: string, options: { worktree?: boolean; projectSnapshot?: ProjectSnapshot; lintingSnapshot?: LintingSnapshot; precomputedRefreshFromGit?: Awaited<ReturnType<typeof collectRefreshFromGit>> | Awaited<ReturnType<typeof collectRefreshFromWorktree>> } = {}) {
  const [lintingSnapshot, projectSnapshot] = await Promise.all([
    options.lintingSnapshot ?? loadLintingSnapshot(project, { noteIndex: true }),
    options.projectSnapshot ?? loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true }),
  ]);
  const [status, verify, drift, lint, semantic, backlog] = await Promise.all([
    collectStatusRow(project, lintingSnapshot),
    collectVerifySummary(project, lintingSnapshot),
    collectDriftSummary(project, explicitRepo, lintingSnapshot),
    collectLintResult(project, lintingSnapshot),
    collectSemanticLintResult(project, lintingSnapshot),
    collectBacklog(project),
  ]);
  const maintain = await collectMaintenancePlan(project, base, explicitRepo, projectSnapshot, lintingSnapshot, { worktree: options.worktree, precomputedRefreshFromGit: options.precomputedRefreshFromGit });
  const focus = maintain.focus;
  const backlogConsistencyWarnings = await collectBacklogConsistencyWarnings(project, backlog.sections);

  const totalRepoFiles = maintain.discover.repoFiles || 1;
  const coverageRatio = maintain.discover.boundFiles / totalRepoFiles;
  const coveragePenalty = Math.round((1 - coverageRatio) * 40);
  const penalty = (
    drift.stale * 6 +
    drift.renamed * 5 +
    drift.deleted * 8 +
    drift.unknown * 4 +
    Math.min(drift.unboundPages.length * 2, 10) +
    Math.min(lint.issues.length * 2, 20) +
    Math.min(semantic.issues.length * 2, 10) +
    coveragePenalty +
    Math.min(maintain.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length * 3, 20)
  );
  const score = Math.max(0, 100 - penalty);

  return {
    project,
    base,
    score,
    status,
    verify,
    drift,
    lint,
    semantic,
    backlog,
    focus,
    backlogWarnings: [...focus.warnings, ...backlogConsistencyWarnings],
    maintain,
    counts: {
      stale: drift.stale,
      renamed: drift.renamed,
      deleted: drift.deleted,
      unknown: drift.unknown,
      unbound: drift.unboundPages.length,
      lint: lint.issues.length,
      semantic: semantic.issues.length,
      uncovered: maintain.discover.uncoveredFiles.length,
      repoDocs: maintain.discover.repoDocFiles.length,
      missingTests: maintain.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length,
      backlogWarnings: focus.warnings.length + backlogConsistencyWarnings.length,
    },
    topActions: maintain.actions.slice(0, 25),
    backlogConsistencyWarnings,
  };
}

async function collectBacklogConsistencyWarnings(project: string, sections: Record<string, Array<{ id: string }>>) {
  const warnings: string[] = [];
  const entries: Array<{ section: string; item: { id: string } }> = [];
  for (const [section, items] of Object.entries(sections)) {
    for (const item of items) {
      entries.push({ section, item });
    }
  }
  const summaries = await Promise.all(entries.map(({ item }) => readSliceSummary(project, item.id)));
  for (let i = 0; i < entries.length; i++) {
    const { section, item } = entries[i];
    const { status, completedAt } = summaries[i];
    if (!status && !completedAt) continue;
    if (section === "Done") {
      if (status !== "done" || !completedAt) {
        warnings.push(`${item.id} legacy done-slice metadata drift; run wiki maintain ${project} --repair-done-slices`);
      }
      continue;
    }
    if (status === "done") warnings.push(`${item.id} is marked done in slice docs but still lives in ${section}`);
    if (completedAt) warnings.push(`${item.id} records completed_at in slice docs but still lives in ${section}`);
  }
  return warnings;
}

export function compactDoctorForJson(result: Awaited<ReturnType<typeof collectDoctor>>) {
  const MAX_DRIFT_ROWS = 30;
  const driftedRows = result.drift.results.filter((row) => row.status !== "fresh");
  const truncatedDrift = driftedRows.length > MAX_DRIFT_ROWS;
  return {
    ...result,
    drift: {
      ...result.drift,
      results: driftedRows.slice(0, MAX_DRIFT_ROWS).map(({ absolutePath, ...row }) => row),
      ...(truncatedDrift ? { truncated: true, totalDrifted: driftedRows.length } : {}),
    },
    maintain: {
      ...result.maintain,
      refreshFromGit: {
        ...result.maintain.refreshFromGit,
        impactedPages: result.maintain.refreshFromGit.impactedPages?.slice(0, 25),
      },
    },
    backlog: {
      ...result.backlog,
      sections: Object.fromEntries(
        Object.entries(result.backlog.sections).map(([section, items]) => [
          section,
          items.slice(0, 15),
        ]),
      ),
    },
  };
}
