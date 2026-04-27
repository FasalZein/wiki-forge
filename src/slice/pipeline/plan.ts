export type PipelinePhase = "close" | "verify";

export interface PipelineStepDef {
  id: string;
  label: string;
  phase: PipelinePhase;
  command: string;
  extraArgs?: string[];
}

export interface PipelineStepResult {
  id: string;
  label: string;
  skipped: boolean;
  ok: boolean;
  error: string | null;
  stdout?: string;
  stderr?: string;
  durationMs: number | null;
  rerunCommand: string;
  upstreamMutated: boolean;
  skippedReason?: "completed" | "fingerprint-mismatch";
  previousFingerprint?: string | null;
}

export type PipelineRunOptions = {
  project: string;
  sliceId: string;
  phase: PipelinePhase;
  repo?: string;
  base?: string;
  dryRun?: boolean;
  json?: boolean;
  worktree?: boolean;
  sliceLocal?: boolean;
};

const CLOSE_STEPS: PipelineStepDef[] = [
  { id: "checkpoint", label: "checkpoint", phase: "close", command: "checkpoint" },
  { id: "lint-repo", label: "lint-repo", phase: "close", command: "lint-repo" },
  { id: "maintain", label: "maintain", phase: "close", command: "maintain" },
  { id: "update-index", label: "update-index", phase: "close", command: "update-index", extraArgs: ["--write"] },
];

const VERIFY_STEPS: PipelineStepDef[] = [
  { id: "verify-slice", label: "verify-slice", phase: "verify", command: "verify-slice" },
  { id: "closeout", label: "closeout", phase: "verify", command: "closeout" },
  { id: "gate", label: "gate", phase: "verify", command: "gate" },
  { id: "close-slice", label: "close-slice", phase: "verify", command: "close-slice" },
];

export function pipelineSteps(phase: PipelinePhase): PipelineStepDef[] {
  return phase === "close" ? [...CLOSE_STEPS] : [...VERIFY_STEPS];
}

export function buildPipelineStepArgs(step: PipelineStepDef, options: PipelineRunOptions): string[] {
  const args: string[] = [];
  const sliceCommands = new Set(["verify-slice", "close-slice"]);
  const projectCommands = new Set(["checkpoint", "lint-repo", "maintain", "closeout", "gate", "update-index"]);

  if (sliceCommands.has(step.command)) {
    args.push(options.project, options.sliceId);
  } else if (projectCommands.has(step.command)) {
    args.push(options.project);
  }

  if (options.repo) args.push("--repo", options.repo);
  if (options.base && step.command !== "update-index") args.push("--base", options.base);
  if (options.worktree) args.push("--worktree");
  if (options.sliceLocal && ["checkpoint", "closeout", "gate", "close-slice"].includes(step.command)) {
    args.push("--slice-local");
    if (step.command !== "close-slice") args.push("--slice-id", options.sliceId);
  }
  if (step.extraArgs) args.push(...step.extraArgs);

  return args;
}

export function buildPipelineRerunCommand(command: string, args: string[]) {
  const renderedArgs = args.map(quoteShellArg).join(" ");
  return renderedArgs ? `wiki ${command} ${renderedArgs}` : `wiki ${command}`;
}

export function stepMutatesPipelineState(command: string) {
  return command === "maintain" || command === "update-index" || command === "close-slice";
}

function quoteShellArg(value: string) {
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}
