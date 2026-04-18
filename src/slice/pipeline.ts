import { requireValue } from "../cli-shared";
import { readFlagValue } from "../lib/cli-utils";
import { resolveDefaultBase } from "../git-utils";
import { PipelineState, runPipeline, type PipelinePhase } from "../lib/pipeline";

export async function pipelineCommand(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");

  const phaseIndex = args.indexOf("--phase");
  const phaseRaw = phaseIndex >= 0 ? args[phaseIndex + 1] : undefined;
  requireValue(phaseRaw, "phase (--phase close|verify)");
  if (phaseRaw !== "close" && phaseRaw !== "verify") {
    throw new Error(`invalid phase: ${phaseRaw}. Must be 'close' or 'verify'.`);
  }
  const phase: PipelinePhase = phaseRaw;

  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : await resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");

  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const worktree = args.includes("--worktree");

  const result = await runPipeline({ project, sliceId, phase, repo, base, dryRun, json, worktree });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`pipeline ${phase} for ${project}/${sliceId}${dryRun ? " (dry-run)" : ""}:`);
    for (const step of result.steps) {
      let status = "FAILED";
      if (step.skipped) status = "skipped";
      else if (step.ok) status = "ok";
      const duration = step.durationMs !== null ? ` (${step.durationMs}ms)` : "";
      console.log(`  ${step.id}: ${status}${duration}`);
      if (step.error) console.log(`    error: ${step.error}`);
    }
    console.log(`result: ${result.ok ? "PASS" : "FAIL"}`);
  }

  if (!result.ok) throw new Error(`pipeline ${phase} failed at ${result.stoppedAt}`);
}

export async function pipelineResetCommand(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const stepId = readFlagValue(args, "--step");
  const state = new PipelineState();
  try {
    if (stepId) {
      state.resetStep(project, sliceId, stepId);
      console.log(`reset pipeline step ${stepId} for ${project}/${sliceId}`);
    } else {
      state.reset(project, sliceId);
      console.log(`reset all pipeline steps for ${project}/${sliceId}`);
    }
  } finally {
    state.close();
  }
}
