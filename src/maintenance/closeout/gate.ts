import { basename, join } from "node:path";
import { classifyDiagnosticFindings, formatDiagnosticFindingLines, isHardDiagnostic, groupDiagnosticFindings, type DiagnosticFinding } from "../shared";
import { readFlagValue } from "../../lib/cli-utils";
import { printError, printJson, printLine } from "../../lib/cli-output";
import { exists, readText } from "../../lib/fs";
import { resolveRepoPath, assertGitRepo } from "../../lib/verification";
import { parseProjectRepoBaseArgs, resolveBaseRevision } from "../../git-utils";
import { isTestFile } from "../health";
import { collectDoctor, compactDoctorForJson } from "../doctor";
import { collectCloseout } from "./index";
import { collectSliceLocalContext, fileMatchesSliceClaims, readSliceHub } from "../../slice/docs";
import { collectSliceOwnershipMap } from "../../forge/core/ownership-map";

export async function gateProject(args: string[]) {
  const { project, repo, base, baseFallbackNote } = await parseProjectRepoBaseArgs(args, {
    fallbackToHeadIfUnresolvable: true,
    fallbackLabel: "gate",
  });
  const json = args.includes("--json");
  const structuralRefactor = args.includes("--structural-refactor");
  const worktree = args.includes("--worktree");
  const sliceLocal = args.includes("--slice-local");
  const sliceId = readFlagValue(args, "--slice-id");
  if (baseFallbackNote) printError(baseFallbackNote);
  const result = await collectGate(project, base, repo, { structuralRefactor, worktree, sliceLocal, sliceId });
  if (json) {
    printJson({ ...result, doctor: compactDoctorForJson(result.doctor) });
  } else {
    printLine(`gate for ${project}: ${result.ok ? "PASS" : "FAIL"}`);
    printLine(`- missing tests: ${result.counts.missingTests}`);
    printLine(`- lint issues: ${result.counts.lint}`);
    printLine(`- semantic issues: ${result.counts.semantic}`);
    printLine(`- uncovered changed files: ${result.counts.uncoveredChangedFiles}`);
    if (result.diagnostics.blockers.length) {
      printLine(`- blockers:`);
      for (const finding of result.diagnostics.blockers) printDiagnosticFinding(`  - [hard][${finding.scope}]`, finding);
    }
    if (result.diagnostics.actionableWarnings.length) {
      printLine(`- actionable warnings:`);
      for (const finding of result.diagnostics.actionableWarnings) printDiagnosticFinding(`  - [soft][${finding.scope}]`, finding);
    }
    if (result.diagnostics.projectDebtWarnings.length) {
      printLine(`- project debt warnings: ${result.diagnostics.projectDebtWarnings.length} (use --json for details)`);
    }
    if (result.diagnostics.historicalWarnings.length) {
      printLine(`- historical warnings: ${result.diagnostics.historicalWarnings.length} (use --json for details)`);
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
      const hub = await readSliceHub(project, sliceLocalContext.sliceId);
      const exemptions = Array.isArray(hub.data.test_exemptions) ? hub.data.test_exemptions.map(String) : [];
      const isExempt = (file: string) => exemptions.some((p) => p.includes("*") ? new Bun.Glob(p).match(file) || new Bun.Glob(p).match(basename(file)) : file === p || file.endsWith(`/${p}`));
      const testHealth = doctor.maintain.refreshFromGit.testHealth;
      const nonExemptMissing = testHealth.codeFilesWithoutChangedTests.filter((file) => !isExempt(file));
      const sliceMissingTests = nonExemptMissing.filter((file) => fileMatchesSliceClaims(file, sliceLocalContext));
      const otherMissingTests = nonExemptMissing.filter((file) => !fileMatchesSliceClaims(file, sliceLocalContext));
      if (sliceMissingTests.length > 0) findings.push({
        scope: "slice",
        severity: "blocker",
        message: `${sliceMissingTests.length} changed code file(s) have no matching changed tests`,
        files: sliceMissingTests,
        details: buildTestMatcherDetails(testHealth, sliceMissingTests),
        repair: buildMissingTestRepair(project, sliceLocalContext.sliceId, repo, base, options.worktree),
      });
      if (otherMissingTests.length > 0) findings.push({
        scope: "history",
        severity: "warning",
        message: `${otherMissingTests.length} changed file(s) outside the active slice also need test coverage`,
        files: otherMissingTests,
        details: buildTestMatcherDetails(testHealth, otherMissingTests),
        repair: [`Bind the file to the active slice or move the change out of this diff, then rerun ${formatForgeCheckCommand(project, sliceLocalContext.sliceId, repo, base, options.worktree)}.`],
      });
    } else {
      const testHealth = doctor.maintain.refreshFromGit.testHealth;
      findings.push({
        scope: "slice",
        severity: "blocker",
        message: `${doctor.counts.missingTests} changed code file(s) have no matching changed tests`,
        files: testHealth.codeFilesWithoutChangedTests,
        details: buildTestMatcherDetails(testHealth, testHealth.codeFilesWithoutChangedTests),
        repair: [`Add or update tests for the listed changed code files, then rerun wiki gate ${project} --repo ${repo} ${options.worktree ? "--worktree" : `--base ${base}`}.`],
      });
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
    const ownership = collectSliceOwnershipMap({
      changedFiles: doctor.maintain.refreshFromGit.changedFiles,
      activeSliceId: sliceLocalContext.sliceId,
      activeClaimPaths: sliceLocalContext.claimPaths,
    });
    const sliceUncovered = doctor.maintain.refreshFromGit.uncoveredFiles.filter((file) => fileMatchesSliceClaims(file, sliceLocalContext));
    const unownedChangedFiles = ownership.entries.filter((entry) => entry.kind === "unowned").map((entry) => entry.file);
    if (sliceUncovered.length > 0) findings.push({ scope: "slice", severity: "warning", message: `${sliceUncovered.length} changed file(s) are not covered by wiki bindings`, files: sliceUncovered });
    if (unownedChangedFiles.length > 0) findings.push({ scope: "history", severity: "blocker", message: `${unownedChangedFiles.length} changed file(s) are unowned by the active slice`, files: unownedChangedFiles });
  } else if (doctor.maintain.refreshFromGit.uncoveredFiles.length > 0) findings.push({ scope: "slice", severity: "warning", message: `${doctor.maintain.refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings`, files: doctor.maintain.refreshFromGit.uncoveredFiles });
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
  const classifiedFindings = classifyDiagnosticFindings(findings);
  const blockers = classifiedFindings.filter(isHardDiagnostic).map((finding) => finding.message);
  const warnings = classifiedFindings.filter((finding) => !isHardDiagnostic(finding)).map((finding) => finding.message);
  const diagnostics = groupDiagnosticFindings(classifiedFindings);
  return {
    project,
    base,
    ok: blockers.length === 0,
    findings: classifiedFindings,
    diagnostics,
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

type TestHealthDiagnosticInput = {
  changedTestFiles: string[];
  codeTestMatches?: Array<{ file: string; keys: string[]; matchedTestFiles: string[] }>;
};

function buildTestMatcherDetails(testHealth: TestHealthDiagnosticInput, files: string[]) {
  const details = [
    `Changed tests considered: ${testHealth.changedTestFiles.length ? testHealth.changedTestFiles.join(", ") : "none"}`,
  ];
  const matches = testHealth.codeTestMatches ?? [];
  for (const file of files) {
    const match = matches.find((entry) => entry.file === file);
    if (!match) continue;
    details.push(`${file} matcher keys: ${match.keys.length ? match.keys.join(", ") : "none"}`);
  }
  return details;
}

function buildMissingTestRepair(project: string, sliceId: string, repo: string, base: string, worktree: boolean | undefined) {
  const rerun = formatForgeCheckCommand(project, sliceId, repo, base, worktree);
  return [
    "Add or update a changed test whose name/path matches the listed code file, or document intentional indirect coverage with a test_exemptions entry on the slice hub.",
    `Rerun: ${rerun}`,
  ];
}

function formatForgeCheckCommand(project: string, sliceId: string, repo: string, base: string, worktree: boolean | undefined) {
  return `wiki forge check ${project} ${sliceId} --repo ${repo} ${worktree ? "--worktree" : `--base ${base}`}`;
}

function printDiagnosticFinding(prefix: string, finding: DiagnosticFinding) {
  const [firstLine = finding.message, ...detailLines] = formatDiagnosticFindingLines(finding);
  printLine(`${prefix} ${firstLine}`);
  for (const line of detailLines) printLine(`    ${line}`);
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
  const scripts = JSON.parse(await readText(packageJsonPath)).scripts ?? {}; // desloppify:ignore EMPTY_OBJECT_FALLBACK
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
  const resolvedRevision = await resolveBaseRevision(repo, revision);
  const proc = await Bun.$`git ls-tree -r --name-only ${resolvedRevision}`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString().trim() || `git ls-tree failed for ${revision}`);
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter((line) => line && isTestFile(line)).length;
}
