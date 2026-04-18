import { runWiki } from "./test-helpers";

export type SimStep = {
  step: number;
  triage: string;
  command: string;
  exitCode: number;
  reason: string;
};

export type SimResult = {
  steps: SimStep[];
  terminalTriage: string;
  converged: boolean;
};

export type SimOptions = {
  stepBudget?: number;
  onStep?: (step: SimStep) => void;
};

const TERMINAL_KINDS = new Set(["completed", "plan-next"]);

export function runAgentSim(
  project: string,
  repo: string,
  base: string,
  env: Record<string, string>,
  options: SimOptions = {},
): SimResult {
  const budget = options.stepBudget ?? 12;
  const steps: SimStep[] = [];
  let terminalTriage = "";
  let converged = false;

  for (let step = 0; step < budget; step += 1) {
    const resumeResult = runWiki(["resume", project, "--repo", repo, "--base", base, "--json"], env);
    if (resumeResult.exitCode !== 0) {
      throw new Error(`resume failed at step ${step}: ${resumeResult.stderr.toString()}`);
    }
    const resume = JSON.parse(resumeResult.stdout.toString());
    const triage = resume.triage as { kind: string; reason: string; command: string };

    const entry: SimStep = {
      step,
      triage: triage.kind,
      command: triage.command,
      exitCode: 0,
      reason: triage.reason,
    };

    const isTerminal = TERMINAL_KINDS.has(triage.kind) && !resume.activeTask && !resume.nextTask;
    if (isTerminal) {
      terminalTriage = triage.kind;
      converged = true;
      steps.push({ ...entry, exitCode: 0 });
      options.onStep?.(entry);
      break;
    }

    const parsed = parseTriageCommand(triage.command, repo, base);
    const cmdResult = runWiki(parsed, env);
    entry.exitCode = cmdResult.exitCode;
    steps.push(entry);
    options.onStep?.(entry);

    if (cmdResult.exitCode !== 0) {
      terminalTriage = `error-${triage.kind}`;
      break;
    }
  }

  return { steps, terminalTriage, converged };
}

export function parseTriageCommand(command: string, repo: string, base: string): string[] {
  const placeholders: Record<string, string> = {
    "<path>": repo,
    "<repo>": repo,
    "<base>": base,
  };
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "wiki") {
    throw new Error(`unexpected triage command (expected 'wiki …'): ${command}`);
  }
  const argv = tokens.slice(1).map((token) => placeholders[token] ?? token);
  if (!argv.includes("--repo")) argv.push("--repo", repo);
  return argv;
}
