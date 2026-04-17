import { join } from "node:path";
import { requireValue } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { resolveRepoPath, assertGitRepo } from "../lib/verification";
import { resolveDefaultBase } from "../git-utils";
import { isTestFile } from "./test-health";
import { collectDoctor, compactDoctorForJson } from "./doctor";
import { collectCloseout } from "./closeout";

export async function gateProject(args: string[]) {
  const project = args.find((arg, index) => index === 0 || (!arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--base"));
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : await resolveDefaultBase(project, repo);
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

export async function collectGate(project: string, base: string, explicitRepo?: string, options: { structuralRefactor?: boolean; worktree?: boolean; precomputedCloseout?: Awaited<ReturnType<typeof collectCloseout>> } = {}) {
  const doctor = await collectDoctor(project, base, explicitRepo, { worktree: options.worktree, precomputedRefreshFromGit: options.precomputedCloseout?.refreshFromGit });
  const repo = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repo);
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
  let closeout;
  if (options.precomputedCloseout) {
    closeout = options.precomputedCloseout;
  } else if (options.worktree) {
    closeout = await collectCloseout(project, base, explicitRepo, undefined, undefined, { worktree: true });
  } else {
    closeout = null;
  }
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
