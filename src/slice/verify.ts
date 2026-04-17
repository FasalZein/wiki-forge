import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { requireValue } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { extractShellCommandBlocks, readSliceTestPlan } from "../lib/slices";
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
  const commands = extractShellCommandBlocks(testPlan.content);
  if (!commands.length) throw new Error(`no shell command blocks found in ${relative(VAULT_ROOT, testPlan.path)}`);

  const results = await Promise.all(commands.map((command) => runVerificationCommand(repo, command)));
  const ok = results.every((result) => result.ok);
  if (ok) await applyVerificationLevel(testPlan.path, "test-verified", false, relative(VAULT_ROOT, testPlan.path), true);
  appendLogEntry("verify-slice", sliceId, { project, details: [`commands=${results.length}`, `ok=${ok}`] });
  const payload = { project, sliceId, ok, testPlan: relative(VAULT_ROOT, testPlan.path), commands: results };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`verify-slice ${sliceId}: ${ok ? "PASS" : "FAIL"}`);
    for (const result of results) {
      console.log(`- ${result.ok ? "pass" : "FAIL"}: ${result.command} (exit ${result.exitCode})`);
      if (!result.ok) {
        if (result.stderr) {
          for (const line of result.stderr.split("\n").slice(0, 10)) console.log(`    stderr: ${line}`);
        }
        if (result.stdout) {
          for (const line of result.stdout.split("\n").slice(0, 10)) console.log(`    stdout: ${line}`);
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

async function runVerificationCommand(repo: string, command: string) {
  const proc = await Bun.$`bash -lc ${command}`.cwd(repo).nothrow().quiet();
  return {
    command,
    ok: proc.exitCode === 0,
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}
