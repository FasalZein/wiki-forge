import { join } from "node:path";
import { requireValue } from "../cli-shared";
import type { DiagnosticFinding } from "../lib/diagnostics";
import { collectSliceLocalContext, fileMatchesSliceClaims } from "../lib/slice-local";
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
  const sliceLocal = args.includes("--slice-local");
  const sliceId = readFlagValue(args, "--slice-id");
  const result = await collectGate(project, base, repo, { structuralRefactor, worktree, sliceLocal, sliceId });
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
      for (const finding of result.findings.filter((entry) => entry.severity === "blocker")) console.log(`  - [${finding.scope}] ${finding.message}`);
    }
    if (result.warnings.length) {
      console.log(`- warnings:`);
      for (const finding of result.findings.filter((entry) => entry.severity === "warning")) console.log(`  - [${finding.scope}] ${finding.message}`);
    }
  }
  if (!result.ok) throw new Error(`gate failed for ${project}`);
}

export async function collectGate(project: string, base: string, explicitRepo?: string, options: { structuralRefactor?: boolean; worktree?: boolean; precomputedCloseout?: Awaited<ReturnType<typeof collectCloseout>>; sliceLocal?: boolean; sliceId?: string } = {}) {
  const doctor = await collectDoctor(project, base, explicitRepo, { worktree: options.worktree, precomputedRefreshFromGit: options.precomputedCloseout?.refreshFromGit });
  const repo = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repo);
  const findings: DiagnosticFinding[] = [];
  const sliceLocalContext = options.sliceLocal && options.sliceId ? await collectSliceLocalContext(project, options.sliceId) : null;
  let structuralRefactor: Awaited<ReturnType<typeof collectStructuralRefactorStatus>> | null = null;
  if (doctor.counts.missingTests > 0) {
    if (options.structuralRefactor) {
      structuralRefactor = await collectStructuralRefactorStatus(repo, base);
      if (!structuralRefactor.ok) {
        for (const blocker of structuralRefactor.blockers) findings.push({ scope: "slice", severity: "blocker", message: blocker });
      }
    } else if (sliceLocalContext) {
      const sliceMissingTests = doctor.maintain.refreshFromGit.testHealth.codeFilesWithoutChangedTests.filter((file) => fileMatchesSliceClaims(file, sliceLocalContext));
      const otherMissingTests = doctor.maintain.refreshFromGit.testHealth.codeFilesWithoutChangedTests.filter((file) => !fileMatchesSliceClaims(file, sliceLocalContext));
      if (sliceMissingTests.length > 0) findings.push({ scope: "slice", severity: "blocker", message: `${sliceMissingTests.length} changed code file(s) have no matching changed tests` });
      if (otherMissingTests.length > 0) findings.push({ scope: "history", severity: "warning", message: `${otherMissingTests.length} changed file(s) outside the active slice also need test coverage` });
    } else {
      findings.push({ scope: "slice", severity: "blocker", message: `${doctor.counts.missingTests} changed code file(s) have no matching changed tests` });
    }
  }
  let closeout;
  if (options.precomputedCloseout) {
    closeout = options.precomputedCloseout;
  } else if (options.worktree) {
    closeout = await collectCloseout(project, base, explicitRepo, undefined, undefined, { worktree: true, sliceLocal: options.sliceLocal, sliceId: options.sliceId });
  } else {
    closeout = null;
  }
  if (closeout?.staleImpactedPages.length && !options.sliceLocal) findings.push({ scope: "slice", severity: "blocker", message: `${closeout.staleImpactedPages.length} impacted page(s) are stale or otherwise drifted` });
  if (closeout && options.sliceLocal) {
    for (const finding of closeout.findings.filter((finding) => finding.scope !== "slice" || finding.severity !== "blocker")) {
      findings.push(finding);
    }
  }
  if (doctor.counts.lint > 0) findings.push({ scope: "project", severity: "warning", message: `${doctor.counts.lint} structural lint issue(s)` });
  if (doctor.counts.semantic > 0) findings.push({ scope: "project", severity: "warning", message: `${doctor.counts.semantic} semantic lint issue(s)` });
  if (!options.worktree && doctor.drift.stale > 0) findings.push({ scope: "project", severity: "warning", message: `${doctor.drift.stale} impacted/bound page(s) are stale — run refresh, update docs, and verify-page before closeout` });
  if (sliceLocalContext) {
    const sliceUncovered = doctor.maintain.refreshFromGit.uncoveredFiles.filter((file) => fileMatchesSliceClaims(file, sliceLocalContext));
    const otherUncovered = doctor.maintain.refreshFromGit.uncoveredFiles.filter((file) => !fileMatchesSliceClaims(file, sliceLocalContext));
    if (sliceUncovered.length > 0) findings.push({ scope: "slice", severity: "warning", message: `${sliceUncovered.length} changed file(s) are not covered by wiki bindings` });
    if (otherUncovered.length > 0) findings.push({ scope: "history", severity: "warning", message: `${otherUncovered.length} changed file(s) outside the active slice are not covered by wiki bindings` });
  } else if (doctor.maintain.refreshFromGit.uncoveredFiles.length > 0) findings.push({ scope: "slice", severity: "warning", message: `${doctor.maintain.refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings` });
  if (doctor.counts.repoDocs > 0) findings.push({ scope: "project", severity: "warning", message: `${doctor.counts.repoDocs} repo markdown doc(s) should live in the wiki vault` });
  for (const warning of doctor.backlogConsistencyWarnings) findings.push({ scope: "history", severity: "warning", message: warning });
  for (const action of doctor.maintain.actions.filter((action) => action.scope === "parent")) findings.push({ scope: "parent", severity: "warning", message: action.message });
  if (structuralRefactor?.ok) findings.push({ scope: "slice", severity: "warning", message: `structural refactor exception: ${doctor.counts.missingTests} changed code file(s) skipped direct changed-test matching; typecheck/build/test parity remained intact` });
  if (!options.structuralRefactor) {
    const repoChecks = await resolveRepoScriptChecks(repo);
    const typecheckCheck = repoChecks.find((c) => c.label === "typecheck");
    if (typecheckCheck) {
      const result = await runRepoCheck(repo, typecheckCheck);
      if (!result.ok) {
        findings.push({ scope: "slice", severity: "blocker", message: "typecheck failed" });
      }
    }
  }
  const blockers = findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.message);
  const warnings = findings.filter((finding) => finding.severity === "warning").map((finding) => finding.message);
  return {
    project,
    base,
    ok: blockers.length === 0,
    findings,
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

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
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
