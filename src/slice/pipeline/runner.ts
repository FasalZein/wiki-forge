import { collectGitInputFingerprint } from "../../forge/core/git-truth";
import { drainBoundedTextStream } from "../../lib/bounded-output";
import { PipelineState } from "../../lib/pipeline-state";
import {
  buildPipelineRerunCommand,
  buildPipelineStepArgs,
  pipelineSteps,
  stepMutatesPipelineState,
  type PipelinePhase,
  type PipelineStepResult,
  type PipelineRunOptions,
} from "./plan";

export interface PipelineResult {
  project: string;
  sliceId: string;
  phase: PipelinePhase;
  steps: PipelineStepResult[];
  ok: boolean;
  stoppedAt: string | null;
}

export interface RunPipelineOptions extends PipelineRunOptions {
  upstreamMutatedBeforeStart?: boolean;
  onStepComplete?: (step: {
    id: string;
    label: string;
    ok: boolean;
    error: string | null;
    durationMs: number | null;
    rerunCommand: string;
    upstreamMutated: boolean;
    skippedReason?: "completed" | "fingerprint-mismatch";
    previousFingerprint?: string | null;
  }) => Promise<void>;
}

export async function runPipeline(
  options: RunPipelineOptions,
  executor?: (command: string, args: string[]) => Promise<{ ok: boolean; error?: string; stdout?: string; stderr?: string }>,
  injectedState?: PipelineState,
): Promise<PipelineResult> {
  const steps = pipelineSteps(options.phase);
  const ownsState = !injectedState;
  const state = injectedState ?? new PipelineState();
  let upstreamMutated = Boolean(options.upstreamMutatedBeforeStart);
  const inputFingerprint = options.repo ? await collectPipelineInputFingerprint(options.repo) : null;
  const result: PipelineResult = {
    project: options.project,
    sliceId: options.sliceId,
    phase: options.phase,
    steps: [],
    ok: true,
    stoppedAt: null,
  };

  try {
    for (const step of steps) {
      const skipDecision = state.getSkipDecision(options.project, options.sliceId, step.id, inputFingerprint);
      const skipped = !options.dryRun && skipDecision.shouldSkip;
      const args = buildPipelineStepArgs(step, options);
      const rerunCommand = buildPipelineRerunCommand(step.command, args);
      if (skipped) {
        result.steps.push({
          id: step.id,
          label: step.label,
          skipped: true,
          ok: true,
          error: null,
          durationMs: null,
          rerunCommand,
          upstreamMutated,
        });
        if (options.onStepComplete) {
          await options.onStepComplete({
            id: step.id,
            label: step.label,
            ok: true,
            error: null,
            durationMs: null,
            rerunCommand,
            upstreamMutated,
            ...(skipDecision.reason === "completed" || skipDecision.reason === "fingerprint-mismatch"
              ? { skippedReason: skipDecision.reason, previousFingerprint: skipDecision.previousFingerprint }
              : { previousFingerprint: skipDecision.previousFingerprint }),
          });
        }
        continue;
      }

      if (options.dryRun) {
        result.steps.push({
          id: step.id,
          label: step.label,
          skipped: false,
          ok: true,
          error: skipDecision.reason === "fingerprint-mismatch" ? "git fingerprint changed since last successful run" : null,
          durationMs: null,
          rerunCommand,
          upstreamMutated,
        });
        continue;
      }

      const startedAt = new Date().toISOString();
      state.record(options.project, options.sliceId, step.id, startedAt, null, false, null, inputFingerprint);

      const run = executor
        ? await executor(step.command, args)
        : await executeStep(step.command, args);

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      state.record(options.project, options.sliceId, step.id, startedAt, completedAt, run.ok, run.error ?? null, inputFingerprint);

      result.steps.push({
        id: step.id,
        label: step.label,
        skipped: false,
        ok: run.ok,
        error: run.error ?? null,
        stdout: run.stdout,
        stderr: run.stderr,
        durationMs,
        rerunCommand,
        upstreamMutated,
      });

      if (options.onStepComplete) {
        await options.onStepComplete({
          id: step.id,
          label: step.label,
          ok: run.ok,
          error: run.error ?? null,
          durationMs,
          rerunCommand,
          upstreamMutated,
          previousFingerprint: inputFingerprint,
        });
      }

      if (!run.ok) {
        result.ok = false;
        result.stoppedAt = step.id;
        break;
      }

      if (stepMutatesPipelineState(step.command)) upstreamMutated = true;
    }
  } finally {
    if (ownsState) state.close();
  }

  return result;
}

async function collectPipelineInputFingerprint(repo: string) {
  try {
    return await collectGitInputFingerprint(repo);
  } catch {
    return null;
  }
}

const PIPELINE_STEP_OUTPUT_CHARS = 64_000;
const PIPELINE_STEP_OUTPUT_TAIL_CHARS = 12_000;

async function executeStep(command: string, args: string[]): Promise<{ ok: boolean; error?: string; stdout?: string; stderr?: string }> {
  const wikiPath = process.argv[1];
  if (!wikiPath) return { ok: false, error: "cannot resolve current wiki entrypoint" };

  const proc = Bun.spawn({
    cmd: [process.argv[0], wikiPath, command, ...args],
    env: { ...process.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutResult, stderrResult, exitCode] = await Promise.all([
    drainBoundedTextStream(proc.stdout, {
      maxChars: PIPELINE_STEP_OUTPUT_CHARS,
      tailChars: PIPELINE_STEP_OUTPUT_TAIL_CHARS,
      truncationLabel: "pipeline step stdout truncated",
    }),
    drainBoundedTextStream(proc.stderr, {
      maxChars: PIPELINE_STEP_OUTPUT_CHARS,
      tailChars: PIPELINE_STEP_OUTPUT_TAIL_CHARS,
      truncationLabel: "pipeline step stderr truncated",
    }),
    proc.exited,
  ]);
  const stdout = stdoutResult.text.trim();
  const stderr = stderrResult.text.trim();
  if (exitCode === 0) return { ok: true, stdout: stdout || undefined };
  return { ok: false, error: stderr || `exit code ${exitCode}`, stdout: stdout || undefined, stderr: stderr || undefined };
}
