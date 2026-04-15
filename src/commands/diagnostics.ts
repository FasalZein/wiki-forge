
import { join } from "node:path";
import { requireValue } from "../cli-shared";
import { collectBacklog } from "./backlog";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { isTestFile } from "./maintenance";
import { readSliceSummary } from "../lib/slices";
import { collectLintResult, collectSemanticLintResult, collectStatusRow, collectVerifySummary, loadLintingSnapshot } from "./linting";
import type { LintingSnapshot } from "./linting";
import { collectCloseout, collectMaintenancePlan, collectRefreshFromGit, collectRefreshFromWorktree, loadProjectSnapshot, resolveDefaultBase } from "./maintenance";
import type { ProjectSnapshot } from "./maintenance";
import { collectDriftSummary } from "./verification";
import { exists, readText } from "../lib/fs";

export async function doctorProject(args: string[]) {
  const project = args.find((arg, index) => index === 0 || (!arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--base"));
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  const json = args.includes("--json");
  const worktree = args.includes("--worktree");
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
  for (const action of result.topActions) console.log(`  - [${action.kind}] ${action.message}`);
}

export async function gateProject(args: string[]) {
  const project = args.find((arg, index) => index === 0 || (!arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--base"));
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  const json = args.includes("--json");
  const structuralRefactor = args.includes("--structural-refactor");
  const worktree = args.includes("--worktree");
  const result = await collectGate(project, base, repo, { structuralRefactor, worktree });
  if (json) {
    console.log(JSON.stringify({ ...result, doctor: compactDoctorForJson(result.doctor) }, null, 2));
  } else {
    console.log(`gate for ${project}: ${result.ok ? "PASS" : "FAIL"}`);
    console.log(`- missing tests: ${result.counts.missingTests}`);
    console.log(`- lint issues: ${result.counts.lint}`);
    console.log(`- semantic issues: ${result.counts.semantic}`);
    console.log(`- uncovered changed files: ${result.counts.uncoveredChangedFiles}`);
    if (result.blockers.length) {
      console.log(`- blockers:`);
      for (const blocker of result.blockers) console.log(`  - ${blocker}`);
    }
    if (result.warnings.length) {
      console.log(`- warnings:`);
      for (const warning of result.warnings) console.log(`  - ${warning}`);
    }
  }
  if (!result.ok) throw new Error(`gate failed for ${project}`);
}

export async function collectDoctor(project: string, base: string, explicitRepo?: string, options: { worktree?: boolean; projectSnapshot?: ProjectSnapshot; lintingSnapshot?: LintingSnapshot; precomputedRefreshFromGit?: Awaited<ReturnType<typeof collectRefreshFromGit>> | Awaited<ReturnType<typeof collectRefreshFromWorktree>> } = {}) {
  const [lintingSnapshot, projectSnapshot] = await Promise.all([
    options.lintingSnapshot ?? loadLintingSnapshot(project, { noteIndex: true }),
    options.projectSnapshot ?? loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true }),
  ]);
  // Run independent diagnostics in parallel — all depend only on the snapshots above.
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

  // Coverage ratio: what fraction of repo files are bound to wiki pages?
  const totalRepoFiles = maintain.discover.repoFiles || 1;
  const coverageRatio = maintain.discover.boundFiles / totalRepoFiles;
  const coveragePenalty = Math.round((1 - coverageRatio) * 40); // max 40 points for zero coverage
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

export async function collectGate(project: string, base: string, explicitRepo?: string, options: { structuralRefactor?: boolean; worktree?: boolean; precomputedCloseout?: Awaited<ReturnType<typeof collectCloseout>> } = {}) {
  const doctor = await collectDoctor(project, base, explicitRepo, { worktree: options.worktree, precomputedRefreshFromGit: options.precomputedCloseout?.refreshFromGit });
  const repo = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repo);
  // The gate blocks on the one non-negotiable: code must have tests.
  // Lint and semantic lint are quality signals reported as warnings — they are
  // too noisy to gate on (scaffolded projects always have broken wikilinks,
  // orphan pages, and placeholders).
  const blockers: string[] = [];
  let structuralRefactor: Awaited<ReturnType<typeof collectStructuralRefactorStatus>> | null = null;
  if (doctor.counts.missingTests > 0) {
    if (options.structuralRefactor) {
      structuralRefactor = await collectStructuralRefactorStatus(repo, base);
      if (!structuralRefactor.ok) {
        blockers.push(...structuralRefactor.blockers);
      }
    } else {
      blockers.push(`${doctor.counts.missingTests} changed code file(s) have no matching changed tests`);
    }
  }
  const closeout = options.precomputedCloseout ?? (options.worktree ? await collectCloseout(project, base, explicitRepo, undefined, undefined, { worktree: true }) : null);
  if (closeout?.staleImpactedPages.length) blockers.push(`${closeout.staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`);
  const warnings: string[] = [];
  if (doctor.counts.lint > 0) warnings.push(`${doctor.counts.lint} structural lint issue(s)`);
  if (doctor.counts.semantic > 0) warnings.push(`${doctor.counts.semantic} semantic lint issue(s)`);
  if (!options.worktree && doctor.drift.stale > 0) warnings.push(`${doctor.drift.stale} impacted/bound page(s) are stale — run refresh, update docs, and verify-page before closeout`);
  if (doctor.maintain.refreshFromGit.uncoveredFiles.length > 0) warnings.push(`${doctor.maintain.refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings`);
  if (doctor.counts.repoDocs > 0) warnings.push(`${doctor.counts.repoDocs} repo markdown doc(s) should live in the wiki vault`);
  for (const warning of doctor.backlogConsistencyWarnings) warnings.push(warning);
  if (structuralRefactor?.ok) warnings.push(`structural refactor exception: ${doctor.counts.missingTests} changed code file(s) skipped direct changed-test matching; typecheck/build/test parity remained intact`);
  return {
    project,
    base,
    ok: blockers.length === 0,
    blockers,
    warnings,
    counts: {
      missingTests: doctor.counts.missingTests,
      lint: doctor.counts.lint,
      semantic: doctor.counts.semantic,
      uncoveredChangedFiles: doctor.maintain.refreshFromGit.uncoveredFiles.length,
      repoDocs: doctor.counts.repoDocs,
    },
    doctor,
    ...(closeout ? { closeout } : {}),
    ...(structuralRefactor ? { structuralRefactor } : {}),
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

async function collectStructuralRefactorStatus(repo: string, base: string) {
  const blockers: string[] = [];
  const checks = await Promise.all((await resolveRepoScriptChecks(repo)).map((check) => runRepoCheck(repo, check)));
  for (const check of checks) {
    if (!check.ok) blockers.push(`${check.label} failed for structural refactor gate`);
  }
  const [baseTestCount, headTestCount] = await Promise.all([countTrackedTests(repo, base), countTrackedTests(repo, "HEAD")]);
  if (baseTestCount !== headTestCount) blockers.push(`structural refactor requires unchanged tracked test count (base=${baseTestCount}, head=${headTestCount})`);
  return { ok: blockers.length === 0, blockers, checks, testCount: { base: baseTestCount, head: headTestCount } };
}

async function resolveRepoScriptChecks(repo: string) {
  const packageJsonPath = join(repo, "package.json");
  if (!await exists(packageJsonPath)) return [] as Array<{ label: string; command: string[] }>;
  const scripts = JSON.parse(await readText(packageJsonPath)).scripts ?? {};
  const checks: Array<{ label: string; command: string[] }> = [];
  if (typeof scripts.check === "string") checks.push({ label: "typecheck", command: ["bun", "run", "check"] });
  else if (typeof scripts.typecheck === "string") checks.push({ label: "typecheck", command: ["bun", "run", "typecheck"] });
  if (typeof scripts.build === "string") checks.push({ label: "build", command: ["bun", "run", "build"] });
  if (typeof scripts.test === "string") checks.push({ label: "tests", command: ["bun", "run", "test"] });
  return checks;
}

async function runRepoCheck(repo: string, check: { label: string; command: string[] }) {
  const [cmd, ...cmdArgs] = check.command;
  const proc = await Bun.$`${cmd} ${cmdArgs}`.cwd(repo).nothrow().quiet();
  return { ...check, ok: proc.exitCode === 0, exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

async function countTrackedTests(repo: string, revision: string) {
  const proc = await Bun.$`git ls-tree -r --name-only ${revision}`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return 0;
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter((line) => line && isTestFile(line)).length;
}

/** Strip fresh drift rows, absolute paths, and large nested arrays from JSON output to reduce token consumption. */
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
