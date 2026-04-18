import { relative } from "node:path";
import { bindingMatchesFile, gitHeadSha, gitLines } from "../git-utils";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, requireValue, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { type VerificationCommandSpec, extractVerificationSpecs, readSliceHub, readSliceSourcePaths, readSliceTestPlan } from "../lib/slices";
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
  const warnings = await collectSourcePathsDriftWarnings(project, sliceId, repo);

  const results: VerificationRunResult[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!json) process.stderr.write(`[${i + 1}/${specs.length}] running: ${spec.label ?? spec.command}...`);
    const result = await runVerificationCommand(repo, spec, !json);
    results.push(result);
    if (!json) process.stderr.write(` ${result.ok ? "pass" : "FAIL"}\n`);
  }
  const ok = results.every((result) => result.ok);
  if (ok) {
    await recordVerificationEvidence(testPlan.path, testPlan.content, testPlan.data, repo, results);
    await applyVerificationLevel(testPlan.path, "test-verified", false, relative(VAULT_ROOT, testPlan.path), true);
    const indexPath = projectTaskHubPath(project, sliceId);
    await applyVerificationLevel(indexPath, "test-verified", false, relative(VAULT_ROOT, indexPath), true);
    const planPath = projectTaskPlanPath(project, sliceId);
    await applyVerificationLevel(planPath, "test-verified", false, relative(VAULT_ROOT, planPath), true);
  }
  appendLogEntry("verify-slice", sliceId, { project, details: [`commands=${results.length}`, `ok=${ok}`, `warnings=${warnings.length}`] });
  const payload = { project, sliceId, ok, testPlan: relative(VAULT_ROOT, testPlan.path), commands: results, warnings };
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
    for (const warning of warnings) console.log(`- warning: ${warning}`);
    if (!ok) {
      const failedCount = results.filter((r) => !r.ok).length;
      console.log(`\n${failedCount} of ${results.length} verification command(s) failed.`);
      console.log(`Fix the failing commands, then re-run: wiki verify-slice ${project} ${sliceId} --repo <path>`);
    }
  }
  if (!ok) throw new Error(`verify-slice failed for ${sliceId}`);
}

async function collectSourcePathsDriftWarnings(project: string, sliceId: string, repo: string) {
  const hub = await readSliceHub(project, sliceId);
  const startedAt = typeof hub.data.started_at === "string" ? hub.data.started_at.trim() : "";
  if (!startedAt) return [];

  const declaredSourcePaths = await readSliceSourcePaths(project, sliceId);
  if (declaredSourcePaths.length === 0) return [];

  const touchedFiles = [...new Set(await gitLines(repo, ["log", `--since=${startedAt}`, "--name-only", "--pretty=format:"]))];
  const missingSourcePaths = touchedFiles
    .filter((file) => !declaredSourcePaths.some((sourcePath) => bindingMatchesFile(sourcePath, file) || bindingMatchesFile(file, sourcePath)))
    .sort();
  if (missingSourcePaths.length === 0) return [];
  return [`source_paths drift: files changed since started_at are missing from the slice docs: ${missingSourcePaths.join(", ")}`];
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

async function drainStream(stream: ReadableStream<Uint8Array>, forward: boolean): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    chunks.push(chunk);
    if (forward) process.stderr.write(chunk);
  }
  const tail = decoder.decode();
  if (tail) {
    chunks.push(tail);
    if (forward) process.stderr.write(tail);
  }
  return chunks.join("");
}

async function runVerificationCommand(repo: string, spec: VerificationCommandSpec, streamingAllowed: boolean = true): Promise<VerificationRunResult> {
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", spec.command],
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });

  const startMs = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (streamingAllowed) {
    heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      process.stderr.write(`  … still running (${elapsed}s elapsed)\n`);
    }, 15_000);
  }

  let rawStdout: string;
  let rawStderr: string;
  let exitCode: number;
  try {
    [rawStdout, rawStderr, exitCode] = await Promise.all([
      drainStream(proc.stdout, streamingAllowed),
      drainStream(proc.stderr, streamingAllowed),
      proc.exited,
    ]);
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat);
  }

  const stdout = rawStdout.trim();
  const stderr = rawStderr.trim();
  const failures: string[] = [];
  if (exitCode !== spec.expectedExitCode) failures.push(`expected exit ${spec.expectedExitCode}, got ${exitCode}`);
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
      exitCode,
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
