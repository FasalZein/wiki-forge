import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { requireValue, projectRoot, mkdirIfMissing } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { exists, readText, writeText } from "../lib/fs";
import { collectLintResult } from "./linting";
import { collectDriftSummary } from "./verification";
import { loadLintingSnapshot } from "./linting";
import { parseProjectRepoBaseArgs, findProjectArg } from "./git-utils";
import { buildDirectoryTree } from "./repo-scan";
import { repairHistoricalDoneSlices } from "./slice-repair";
import { guessModuleName } from "./test-health";
import { createModuleInternal } from "./project-setup";
import {
  collectDashboard,
  collectMaintenancePlan,
  collectCloseout,
  collectRefreshFromGit,
  collectDiscoverSummary,
} from "./snapshot";
import type { WorktreeImpactedPage } from "./snapshot";

export async function dashboardProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  console.log(JSON.stringify(await collectDashboard(options.project, options.base, options.repo), null, 2));
}

export async function maintainProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const worktree = args.includes("--worktree");
  const repair = await repairHistoricalDoneSlices(options.project);
  const result = await collectMaintenancePlan(options.project, options.base, options.repo, undefined, undefined, { worktree });
  appendLogEntry("maintain", options.project, {
    project: options.project,
    details: [worktree ? "mode=worktree" : `base=${options.base}`, `actions=${result.actions.length}`, ...(repair ? [`repaired=${repair.repaired.length}`] : [])],
  });
  const missingTests = result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length;
  const gateOk = missingTests === 0;
  if (json) console.log(JSON.stringify({ ...result, ...(repair ? { repair } : {}), gate: { ok: gateOk, missingTests } }, null, 2));
  else {
    if (result.focus.activeTask) console.log(`active task: ${result.focus.activeTask.id} ${result.focus.activeTask.title} (plan=${result.focus.activeTask.planStatus} test-plan=${result.focus.activeTask.testPlanStatus})`);
    else if (result.focus.recommendedTask) console.log(`next backlog task: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
    for (const warning of result.focus.warnings) console.log(`- backlog warning: ${warning}`);
    if (repair) {
      console.log(`legacy done-slice repair: repaired=${repair.repaired.length} already_current=${repair.alreadyCurrent} missing_docs=${repair.missingDocs.length}`);
      if (repair.archiveCandidates.length) console.log(`- archive candidates: ${repair.archiveCandidates.map((candidate) => `${candidate.taskId} (${candidate.ageDays}d)`).join(", ")}`);
    }
    console.log(`maintain plan for ${options.project}:`);
    console.log(`- repo: ${result.repo}`);
    console.log(`- base: ${result.base}`);
    console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
    console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
    console.log(`- uncovered files: ${result.discover.uncoveredFiles.length}`);
    console.log(`- repo docs to move: ${result.discover.repoDocFiles.length}`);
    console.log(`- changed tests: ${result.refreshFromGit.testHealth.changedTestFiles.length}`);
    console.log(`- code changes without changed tests: ${missingTests}`);
    console.log(`- lint issues: ${result.lint.issues.length}`);
    console.log(`- semantic issues: ${result.semanticLint.issues.length}`);
    console.log(`- GATE: ${gateOk ? "PASS" : `FAIL — ${missingTests} code file(s) without tests`}`);
    console.log(`- actions:`);
    for (const action of result.actions) console.log(`  - [${action.kind}] ${action.message}`);
    console.log(`- closeout:`);
    console.log(`  1. run tests`);
    console.log(worktree
      ? `  2. inspect live worktree changes with wiki maintain ${options.project} --repo ${result.repo} --worktree`
      : `  2. wiki refresh-from-git ${options.project} --base ${options.base}`);
    console.log(`  3. wiki drift-check ${options.project} --show-unbound`);
    console.log(`  4. update impacted wiki pages`);
    console.log(`  5. wiki verify-page ${options.project} <page...> <level>`);
    console.log(`  6. wiki lint ${options.project} && wiki lint-semantic ${options.project}`);
    console.log(worktree
      ? `  7. wiki gate ${options.project} --repo ${result.repo} --worktree`
      : `  7. wiki gate ${options.project} --repo ${result.repo} --base ${options.base}`);
  }
}

export async function closeoutProject(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const worktree = args.includes("--worktree");
  const result = await collectCloseout(options.project, options.base, options.repo, undefined, undefined, { worktree });
  if (json) console.log(JSON.stringify(compactCloseoutForJson(result), null, 2));
  else renderCloseout(result, verbose);
  if (!result.ok) throw new Error(`closeout failed for ${options.project}`);
}

export async function refreshProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const lintingSnapshot = await loadLintingSnapshot(project, { noteIndex: true });
  const drift = await collectDriftSummary(project, repo, lintingSnapshot);
  const lint = await collectLintResult(project, lintingSnapshot);
  appendLogEntry("refresh", project, { project, details: [`stale=${drift.stale}`, `deleted=${drift.deleted}`, `unknown=${drift.unknown}`, `unbound=${drift.unboundPages.length}`, `lint_issues=${lint.issues.length}`] });
  const result = { project, repo: drift.repo, drift: { fresh: drift.fresh, stale: drift.stale, deleted: drift.deleted, unknown: drift.unknown, unbound: drift.unboundPages.length }, lint: { ok: lint.issues.length === 0, issues: lint.issues } };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`refresh summary for ${project}:`);
    console.log(`- repo: ${drift.repo}`);
    console.log(`- drift: fresh=${drift.fresh} stale=${drift.stale} deleted=${drift.deleted} unknown=${drift.unknown} unbound=${drift.unboundPages.length}`);
    console.log(`- lint issues: ${lint.issues.length}`);
    if (drift.stale || drift.deleted || drift.unknown) console.log(`- run: wiki drift-check ${project} --show-unbound`);
    if (lint.issues.length) console.log(`- run: wiki lint ${project}`);
    if (!drift.stale && !drift.deleted && !drift.unknown && !lint.issues.length) console.log(`- docs look current`);
  }
}

export async function refreshFromGit(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const result = await collectRefreshFromGit(options.project, options.base, options.repo);
  appendLogEntry("refresh-from-git", options.project, { project: options.project, details: [`base=${result.base}`, `changed=${result.changedFiles.length}`, `impacted=${result.impactedPages.length}`, `uncovered=${result.uncoveredFiles.length}`, `missing_tests=${result.testHealth.codeFilesWithoutChangedTests.length}`] });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`refresh-from-git for ${options.project}:`);
    console.log(`- repo: ${result.repo}`);
    console.log(`- base: ${result.base}`);
    console.log(`- changed files: ${result.changedFiles.length}`);
    console.log(`- impacted pages: ${result.impactedPages.length}`);
    console.log(`- uncovered files: ${result.uncoveredFiles.length}`);
    console.log(`- changed tests: ${result.testHealth.changedTestFiles.length}`);
    console.log(`- code changes without changed tests: ${result.testHealth.codeFilesWithoutChangedTests.length}`);
    for (const page of result.impactedPages) {
      console.log(`  - ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
      for (const line of page.diffSummary.slice(0, 3)) console.log(`    ${line}`);
    }
    if (result.uncoveredFiles.length) {
      console.log(`- uncovered:`);
      for (const file of result.uncoveredFiles) console.log(`  - ${file}`);
    }
    if (result.testHealth.codeFilesWithoutChangedTests.length) {
      console.log(`- missing test companion changes:`);
      for (const file of result.testHealth.codeFilesWithoutChangedTests) console.log(`  - ${file}`);
    }
  }
}

export async function discoverProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const tree = args.includes("--tree");
  const result = await collectDiscoverSummary(project, repo);
  if (json) console.log(JSON.stringify(tree ? { ...result, tree: buildDirectoryTree(result.uncoveredFiles) } : result, null, 2));
  else if (tree) {
    console.log(`discover --tree for ${project}:`);
    console.log(`- repo files: ${result.repoFiles} | bound: ${result.boundFiles} | uncovered: ${result.uncoveredFiles.length}`);
    console.log(`- unbound pages: ${result.unboundPages.length}`);
    console.log("");
    const groups = buildDirectoryTree(result.uncoveredFiles);
    for (const group of groups) {
      const marker = group.files >= 3 ? "  <- module candidate" : "";
      console.log(`${group.directory}/ (${group.files} files)${marker}`);
    }
    if (result.researchDirs.length) {
      console.log("\nrepo-local research docs detected:");
      for (const dir of result.researchDirs) console.log(`  - ${dir}`);
      console.log("  - file durable findings into wiki research notes; use /research for net-new investigation");
    }
    if (result.unboundPages.length) {
      console.log("\nunbound wiki pages:");
      for (const page of result.unboundPages.slice(0, 15)) console.log(`  - ${page}`);
    }
  } else {
    console.log(`discover for ${project}:`);
    console.log(`- repo files: ${result.repoFiles}`);
    console.log(`- bound files: ${result.boundFiles}`);
    console.log(`- uncovered files: ${result.uncoveredFiles.length}`);
    console.log(`- unbound pages: ${result.unboundPages.length}`);
    console.log(`- placeholder-heavy pages: ${result.placeholderHeavyPages.length}`);
    console.log(`- repo docs to move: ${result.repoDocFiles.length}`);
    for (const file of result.uncoveredFiles.slice(0, 20)) console.log(`  - uncovered: ${file}`);
    for (const file of result.repoDocFiles.slice(0, 20)) console.log(`  - repo-doc: ${file}`);
  }
}

export async function collectIngestDiff(project: string, base: string, explicitRepo?: string) {
  const refresh = await collectRefreshFromGit(project, base, explicitRepo);
  const created: string[] = [];
  const updated: string[] = [];
  for (const page of refresh.impactedPages) {
    const pagePath = join(projectRoot(project), page.page);
    const raw = await readText(pagePath);
    const stamp = `\n## Change Digest\n\n- Updated from git diff base \`${base}\`\n${page.matchedSourcePaths.map((source) => `- Source: \`${source}\``).join("\n")}\n`;
    const next = raw.includes("## Change Digest") ? raw.replace(/\n## Change Digest[\s\S]*$/u, stamp.trimEnd() + "\n") : `${raw.trimEnd()}${stamp}`;
    await writeText(pagePath, next);
    updated.push(relative(VAULT_ROOT, pagePath));
  }
  for (const file of refresh.uncoveredFiles) {
    const guessedModule = guessModuleName(file);
    const moduleSpec = join(projectRoot(project), "modules", guessedModule, "spec.md");
    if (await exists(moduleSpec)) continue;
    await mkdirIfMissing(join(projectRoot(project), "modules", guessedModule));
    await createModuleInternal(project, guessedModule, [file]);
    created.push(relative(VAULT_ROOT, moduleSpec));
  }
  return { project, repo: refresh.repo, base, created, updated, refresh };
}

export async function ingestDiff(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const result = await collectIngestDiff(options.project, options.base, options.repo);
  appendLogEntry("ingest-diff", options.project, { project: options.project, details: [`base=${options.base}`, `created=${result.created.length}`, `updated=${result.updated.length}`] });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ingest-diff for ${options.project}:`);
    for (const file of result.created) console.log(`- created ${file}`);
    for (const file of result.updated) console.log(`- updated ${file}`);
  }
}

/** Strip fresh drift rows and absolute paths from closeout JSON to reduce token consumption. */
export function compactCloseoutForJson(result: Awaited<ReturnType<typeof collectCloseout>>) {
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
  };
}

export function renderCloseout(result: Awaited<ReturnType<typeof collectCloseout>>, verbose: boolean) {
  console.log(`closeout for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
  console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
  console.log(`- stale impacted pages: ${result.staleImpactedPages.length}`);
  if (result.suppressedPages.length) console.log(`- suppressed historical done-slice pages: ${result.suppressedPages.length}`);
  console.log(`- lint: ${result.lint.issues.length}`);
  console.log(`- semantic: ${result.semanticLint.issues.length}`);
  console.log(`- missing tests: ${result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length}`);
  if (verbose || !result.ok) {
    for (const page of result.refreshFromGit.impactedPages.slice(0, 20)) console.log(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const blocker of result.blockers) console.log(`  - blocker: ${blocker}`);
    for (const warning of result.warnings) console.log(`  - warning: ${warning}`);
  }
  console.log(`- manual steps:`);
  for (const step of result.nextSteps) console.log(`  - ${step}`);
}
