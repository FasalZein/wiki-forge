import { requireValue } from "../../cli-shared";
import { printJson, printLine } from "../../lib/cli-output";
import { readLatestV1Handover, writeV1Handover } from "../handover/store";
import { loadV1ProjectProjection } from "../vault/load-project";
import { buildV1PromptPacket } from "../prompt/packet";
import { tailV1MemoryLog, writeV1MemoryLogEntry, writeV1MemoryNote } from "../memory/store";

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

export async function v1ExportPrompt(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base"]);
  const project = positional[0];
  requireValue(project, "project");
  const [statusTruth, latestHandover] = await Promise.all([
    loadV1ProjectProjection(project),
    readLatestV1Handover(project),
  ]);
  const packet = buildV1PromptPacket({ project, statusTruth, latestHandover });
  if (json) printJson(packet);
  else printLine(packet.prompt);
}

export async function v1Note(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--agent", "--slice"]);
  const project = positional[0];
  requireValue(project, "project");
  const message = positional.slice(1).join(" ").trim();
  requireValue(message || undefined, "message");
  const record = await writeV1MemoryNote({
    project,
    message,
    agent: readFlagValue(args, "--agent") ?? "agent",
    ...(readFlagValue(args, "--slice") ? { sliceId: readFlagValue(args, "--slice") } : {}),
  });
  if (json) printJson(record);
  else printLine(`noted for ${project}: ${message}`);
}

export async function v1Log(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const subcommand = args[0] ?? "tail";
  if (subcommand === "append") {
    const positional = readPositionalArgs(args.slice(1), ["--details"]);
    const project = positional[0];
    const entryKind = positional[1];
    const title = positional.slice(2).join(" ").trim();
    requireValue(project, "project");
    requireValue(entryKind, "kind");
    requireValue(title || undefined, "title");
    const record = await writeV1MemoryLogEntry({
      project,
      entryKind,
      title,
      details: readRepeatedFlagValues(args, "--details"),
    });
    if (json) printJson(record);
    else printLine(`appended log entry for ${project}: ${entryKind} | ${title}`);
    return;
  }
  if (subcommand === "tail") {
    const positional = readPositionalArgs(args.slice(1), []);
    const project = positional[0];
    requireValue(project, "project");
    const count = Number.parseInt(positional[1] ?? "10", 10);
    const tail = await tailV1MemoryLog(project, Number.isFinite(count) && count > 0 ? count : 10);
    if (json) printJson(tail);
    else for (const entry of tail.entries) printLine(`${entry.createdAt} ${entry.entryKind} | ${entry.title}`);
    return;
  }
  throw new Error(`unknown v1 log subcommand: ${subcommand}`);
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
