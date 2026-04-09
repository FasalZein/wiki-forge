import { requireValue } from "../cli-shared";
import { collectBacklog } from "./backlog";
import { collectLintResult, collectSemanticLintResult, collectStatusRow, collectVerifySummary } from "./linting";
import { collectMaintenancePlan, resolveDefaultBase } from "./maintenance";
import { collectDriftSummary } from "./verification";

export async function doctorProject(args: string[]) {
  const project = args.find((arg, index) => index === 0 || (!arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--base"));
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  const json = args.includes("--json");
  const result = await collectDoctor(project, base, repo);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const gateOk = result.counts.missingTests === 0;
  console.log(`doctor for ${project}:`);
  console.log(`- score: ${result.score}/100`);
  console.log(`- GATE: ${gateOk ? "PASS" : `FAIL — ${result.counts.missingTests} code file(s) without tests`}`);
  console.log(`- stale=${result.counts.stale} renamed=${result.counts.renamed} deleted=${result.counts.deleted} unbound=${result.counts.unbound}`);
  console.log(`- lint=${result.counts.lint} semantic=${result.counts.semantic} uncovered=${result.counts.uncovered} repo_docs=${result.counts.repoDocs} missing_tests=${result.counts.missingTests}`);
  console.log(`- task sections: ${Object.entries(result.backlog.sections).map(([k, v]) => `${k}=${v.length}`).join(" ")}`);
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
  const result = await collectGate(project, base, repo);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
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

export async function collectDoctor(project: string, base: string, explicitRepo?: string) {
  const status = await collectStatusRow(project);
  const verify = await collectVerifySummary(project);
  const drift = collectDriftSummary(project, explicitRepo);
  const lint = await collectLintResult(project);
  const semantic = await collectSemanticLintResult(project);
  const backlog = collectBacklog(project);
  const maintain = await collectMaintenancePlan(project, base, explicitRepo);

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
    },
    topActions: maintain.actions.slice(0, 25),
  };
}

export async function collectGate(project: string, base: string, explicitRepo?: string) {
  const doctor = await collectDoctor(project, base, explicitRepo);
  // The gate blocks on the one non-negotiable: code must have tests.
  // Lint and semantic lint are quality signals reported as warnings — they are
  // too noisy to gate on (scaffolded projects always have broken wikilinks,
  // orphan pages, and placeholders).
  const blockers: string[] = [];
  if (doctor.counts.missingTests > 0) blockers.push(`${doctor.counts.missingTests} changed code file(s) have no matching changed tests`);
  const warnings: string[] = [];
  if (doctor.counts.lint > 0) warnings.push(`${doctor.counts.lint} structural lint issue(s)`);
  if (doctor.counts.semantic > 0) warnings.push(`${doctor.counts.semantic} semantic lint issue(s)`);
  if (doctor.maintain.refreshFromGit.uncoveredFiles.length > 0) warnings.push(`${doctor.maintain.refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings`);
  if (doctor.counts.repoDocs > 0) warnings.push(`${doctor.counts.repoDocs} repo markdown doc(s) should live in the wiki vault`);
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
  };
}
