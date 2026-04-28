import { requireValue } from "../../cli-shared";
import { printJson, printLine } from "../../lib/cli-output";
import { readLatestV1Handover, writeV1Handover } from "../handover/store";
import { loadV1ProjectProjection } from "../vault/load-project";

export async function v1Resume(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base"]);
  const project = positional[0];
  requireValue(project, "project");
  const [statusTruth, latestHandover] = await Promise.all([
    loadV1ProjectProjection(project),
    readLatestV1Handover(project),
  ]);
  const nextAction = readProjectionNextAction(statusTruth);
  const payload = {
    kind: "v1-resume" as const,
    project,
    mutatesLifecycle: false,
    statusTruth,
    latestHandover,
    nextAction,
  };
  if (json) printJson(payload);
  else {
    printLine(`resume ${project}: ${nextAction}`);
    if (latestHandover) {
      printLine(`handover: ${latestHandover.path}`);
      printLine(`prompt: ${latestHandover.copyPastePrompt}`);
    }
  }
}

export async function v1Handover(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--session", "--agent", "--feature", "--prd", "--slice", "--summary", "--next-action", "--prompt"]);
  const project = positional[0];
  requireValue(project, "project");
  const sessionId = readFlagValue(args, "--session") ?? new Date().toISOString().slice(0, 10);
  const summary = readFlagValue(args, "--summary");
  const nextAction = readFlagValue(args, "--next-action");
  const copyPastePrompt = readFlagValue(args, "--prompt");
  requireValue(summary, "--summary");
  requireValue(nextAction, "--next-action");
  requireValue(copyPastePrompt, "--prompt");
  const result = await writeV1Handover({
    project,
    sessionId,
    agent: readFlagValue(args, "--agent") ?? "agent",
    summary,
    nextAction,
    copyPastePrompt,
    relatedFeatures: readRepeatedFlagValues(args, "--feature"),
    relatedPrds: readRepeatedFlagValues(args, "--prd"),
    relatedSlices: readRepeatedFlagValues(args, "--slice"),
  });
  if (json) printJson(result);
  else printLine(`wrote ${result.path}`);
}

function readProjectionNextAction(projection: Awaited<ReturnType<typeof loadV1ProjectProjection>>): string {
  if (projection.status === "conflict") return "resolve-conflict";
  if (projection.status === "needs-repair") return "repair-canonical-records";
  return projection.nextAction;
}

function readPositionalArgs(args: readonly string[], valueFlags: readonly string[]): readonly string[] {
  const valueFlagSet = new Set(valueFlags);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (valueFlagSet.has(arg)) index += 1;
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRepeatedFlagValues(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}
