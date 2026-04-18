import { relative } from "node:path";
import { gitHeadSha } from "../git-utils";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, requireValue, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { type VerificationCommandSpec, extractVerificationSpecs, readSliceTestPlan } from "../lib/slices";
import { projectTaskHubPath, projectTaskPlanPath } from "../lib/structure";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { applyVerificationLevel } from "../verification";

export async function verifySlice(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const repoIndex = args.indexOf("--repo");
  const repo = await resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  await assertGitRepo(repo);
  const json = args.includes("--json");
  const testPlan = await readSliceTestPlan(project, sliceId);
  const specs = extractVerificationSpecs(testPlan.content);
  if (!specs.length) throw new Error(`no verification command blocks found in ${relative(VAULT_ROOT, testPlan.path)}`);

  const results = await Promise.all(specs.map((spec) => runVerificationCommand(repo, spec)));
  const ok = results.every((result) => result.ok);
  if (ok) {
    await recordVerificationEvidence(testPlan.path, testPlan.content, testPlan.data, repo, results);
    await applyVerificationLevel(testPlan.path, "test-verified", false, relative(VAULT_ROOT, testPlan.path), true);
    const indexPath = projectTaskHubPath(project, sliceId);
    await applyVerificationLevel(indexPath, "test-verified", false, relative(VAULT_ROOT, indexPath), true);
    const planPath = projectTaskPlanPath(project, sliceId);
    await applyVerificationLevel(planPath, "test-verified", false, relative(VAULT_ROOT, planPath), true);
  }
  appendLogEntry("verify-slice", sliceId, { project, details: [`commands=${results.length}`, `ok=${ok}`] });
  const payload = { project, sliceId, ok, testPlan: relative(VAULT_ROOT, testPlan.path), commands: results };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`verify-slice ${sliceId}: ${ok ? "PASS" : "FAIL"}`);
    for (const result of results) {
      console.log(`- ${result.ok ? "pass" : "FAIL"}: ${result.label ?? result.command} (exit ${result.actual.exitCode}, expected ${result.expected.exitCode})`);
      if (!result.ok) {
        for (const failure of result.failures) console.log(`    failure: ${failure}`);
        if (result.actual.stderr) {
          for (const line of result.actual.stderr.split("\n").slice(0, 10)) console.log(`    stderr: ${line}`);
        }
        if (result.actual.stdout) {
          for (const line of result.actual.stdout.split("\n").slice(0, 10)) console.log(`    stdout: ${line}`);
        }
      }
    }
    if (!ok) {
      const failedCount = results.filter((r) => !r.ok).length;
      console.log(`\n${failedCount} of ${results.length} verification command(s) failed.`);
      console.log(`Fix the failing commands, then re-run: wiki verify-slice ${project} ${sliceId} --repo <path>`);
    }
  }
  if (!ok) throw new Error(`verify-slice failed for ${sliceId}`);
}

type VerificationRunResult = {
  label: string | null;
  command: string;
  ok: boolean;
  expected: {
    exitCode: number;
    stdoutContains: string[];
    stderrContains: string[];
  };
  actual: {
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  failures: string[];
};

async function runVerificationCommand(repo: string, spec: VerificationCommandSpec): Promise<VerificationRunResult> {
  const proc = await Bun.$`bash -lc ${spec.command}`.cwd(repo).nothrow().quiet();
  const stdout = proc.stdout.toString().trim();
  const stderr = proc.stderr.toString().trim();
  const failures: string[] = [];
  if (proc.exitCode !== spec.expectedExitCode) failures.push(`expected exit ${spec.expectedExitCode}, got ${proc.exitCode}`);
  for (const expected of spec.stdoutContains) {
    if (!stdout.includes(expected)) failures.push(`stdout missing: ${expected}`);
  }
  for (const expected of spec.stderrContains) {
    if (!stderr.includes(expected)) failures.push(`stderr missing: ${expected}`);
  }
  return {
    label: spec.label,
    command: spec.command,
    ok: failures.length === 0,
    expected: {
      exitCode: spec.expectedExitCode,
      stdoutContains: [...spec.stdoutContains],
      stderrContains: [...spec.stderrContains],
    },
    actual: {
      exitCode: proc.exitCode,
      stdout,
      stderr,
    },
    failures,
  };
}

async function recordVerificationEvidence(
  testPlanPath: string,
  content: string,
  data: Record<string, unknown>,
  repo: string,
  results: VerificationRunResult[],
) {
  const verifiedAgainst = await gitHeadSha(repo);
  writeNormalizedPage(
    testPlanPath,
    content,
    orderFrontmatter({
      ...data,
      verification_commands: results.map((result) => ({
        ...(result.label ? { label: result.label } : {}),
        command: result.command,
        expected_exit_code: result.expected.exitCode,
        ...(result.expected.stdoutContains.length ? { stdout_contains: result.expected.stdoutContains } : {}),
        ...(result.expected.stderrContains.length ? { stderr_contains: result.expected.stderrContains } : {}),
      })),
      verified_against: verifiedAgainst,
      updated: nowIso(),
    }, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "claimed_by", "claimed_at", "claim_paths", "created_at", "updated", "completed_at", "status", "verification_level", "verified_against", "verification_commands"]),
  );
}
