import { requireValue } from "../../cli-shared";
import { resolveBaseRevision } from "../../git-utils";
import { printJson, printLine } from "../../lib/cli-output";
import { readLatestForgeHandover, writeForgeHandover } from "./handover/store";
import { detectForgeHandoverStaleness, renderHandoverRecoveryPrompt } from "./handover/freshness";
import { renderStructuredHandoverPrompt } from "./handover/render";
import { loadForgeProjectProjection } from "../../forge/vault/load-project";
import { buildPromptPacket } from "../../wiki/memory/prompt-packet";
import { tailMemoryLog, writeMemoryLogEntry, writeMemoryNote } from "../../wiki/memory/store";

export async function resumeCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base"]);
  const project = positional[0];
  const repo = readFlagValue(args, "--repo") ?? ".";
  requireValue(project, "project");
  const [statusTruth, latestHandover] = await Promise.all([
    loadForgeProjectProjection(project),
    readLatestForgeHandover(project),
  ]);
  const nextAction = readProjectionNextAction(statusTruth);
  const handoverStaleness = latestHandover ? detectForgeHandoverStaleness(latestHandover, repo) : null;
  const payload = {
    kind: "forge-resume" as const,
    project,
    mutatesLifecycle: false,
    statusTruth,
    latestHandover,
    handoverStaleness,
    nextAction,
  };
  if (json) printJson(payload);
  else {
    printLine(`resume ${project}: ${nextAction}`);
    if (latestHandover) {
      printLine(`handover: ${latestHandover.path}`);
      if (handoverStaleness?.status === "stale") {
        printLine(`stale handover prompt: names HEAD/base ${handoverStaleness.promptHead}, current HEAD is ${handoverStaleness.currentHead}.`);
        printLine(`guidance: treat resume as context only; run wiki forge status ${project} --repo ${repo} --json or wiki checkpoint ${project} --repo ${repo} --base HEAD --json before following old prompt instructions.`);
        printLine("Copy/paste recovery prompt:");
        printLine("```text");
        printLine(renderHandoverRecoveryPrompt({ project, repo, currentHead: handoverStaleness.currentHead }));
        printLine("```");
      } else {
        printLine(`operator prompt: ${latestHandover.copyPastePrompt || "none recorded"}`);
      }
    }
  }
}

export async function exportPromptCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base"]);
  const project = positional[0];
  const repo = readFlagValue(args, "--repo") ?? ".";
  requireValue(project, "project");
  const [statusTruth, latestHandover] = await Promise.all([
    loadForgeProjectProjection(project),
    readLatestForgeHandover(project),
  ]);
  const handoverStaleness = latestHandover ? detectForgeHandoverStaleness(latestHandover, repo) : null;
  const recoveryPrompt = handoverStaleness?.status === "stale"
    ? renderHandoverRecoveryPrompt({ project, repo, currentHead: handoverStaleness.currentHead })
    : null;
  const packet = buildPromptPacket({ project, statusTruth, latestHandover, handoverStaleness, recoveryPrompt });
  if (json) printJson(packet);
  else printLine(packet.prompt);
}

export async function noteCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--agent", "--slice"]);
  const project = positional[0];
  requireValue(project, "project");
  const message = positional.slice(1).join(" ").trim();
  requireValue(message || undefined, "message");
  const record = await writeMemoryNote({
    project,
    message,
    agent: readFlagValue(args, "--agent") ?? "agent",
    ...(readFlagValue(args, "--slice") ? { sliceId: readFlagValue(args, "--slice") } : {}),
  });
  if (json) printJson(record);
  else printLine(`noted for ${project}: ${message}`);
}

export async function logCommand(args: string[]): Promise<void> {
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
    const record = await writeMemoryLogEntry({
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
    const tail = await tailMemoryLog(project, Number.isFinite(count) && count > 0 ? count : 10);
    if (json) printJson(tail);
    else for (const entry of tail.entries) printLine(`${entry.createdAt} ${entry.entryKind} | ${entry.title}`);
    return;
  }
  throw new Error(`unknown log subcommand: ${subcommand}`);
}

export async function handoverCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--session", "--agent", "--feature", "--prd", "--slice", "--summary", "--next-action", "--prompt", "--repo", "--base", "--command"]);
  const project = positional[0];
  requireValue(project, "project");
  const sessionId = readFlagValue(args, "--session") ?? new Date().toISOString().slice(0, 10);
  const summary = readFlagValue(args, "--summary");
  const nextAction = readFlagValue(args, "--next-action");
  const operatorPrompt = readFlagValue(args, "--prompt");
  requireValue(summary, "--summary");
  requireValue(nextAction, "--next-action");
  requireValue(operatorPrompt, "--prompt");
  const relatedPrds = readRepeatedFlagValues(args, "--prd");
  const relatedSlices = readRepeatedFlagValues(args, "--slice");
  const repo = readFlagValue(args, "--repo") ?? ".";
  const base = readFlagValue(args, "--base") ?? "HEAD";
  const runbookCommands = readRepeatedFlagValues(args, "--command");
  const resolvedBase = await resolveHandoverBase(repo, base);
  const result = await writeForgeHandover({
    project,
    sessionId,
    agent: readFlagValue(args, "--agent") ?? "agent",
    summary,
    nextAction,
    copyPastePrompt: operatorPrompt,
    baseRevision: resolvedBase,
    runbookCommands,
    relatedFeatures: readRepeatedFlagValues(args, "--feature"),
    relatedPrds,
    relatedSlices,
  });
  const nextSessionPrompt = renderStructuredHandoverPrompt({
    project,
    summary,
    nextAction,
    operatorPrompt,
    relatedPrds,
    relatedSlices,
    runbookCommands,
    repo,
    base: resolvedBase,
    handoverPath: result.path,
  });
  const handoff = {
    requiresUserCopyPaste: true,
    label: "Copy/paste prompt for the next agent session",
    prompt: nextSessionPrompt,
    instruction: "Return this prompt to the user verbatim in a fenced text block; do not only summarize the handover path.",
  };
  if (json) printJson({ ...result, nextSessionPrompt, handoff });
  else {
    printLine("ACTION REQUIRED: give the user this copy/paste prompt for the next agent session.");
    printLine("Copy/paste prompt for the next agent session:");
    printLine("```text");
    printLine(nextSessionPrompt);
    printLine("```");
    printLine(`wrote ${result.path}`);
    const preview = result.handover.summary.split("\n")[0]?.trim() ?? "";
    if (preview) printLine(`summary: ${preview}`);
    printLine("Do not stop at 'handover written'; paste the prompt above back to the user.");
    return;
  }
}

async function resolveHandoverBase(repo: string, base: string): Promise<string> {
  try {
    return await resolveBaseRevision(repo, base);
  } catch (error) {
    if (error instanceof Error) return base;
    throw error;
  }
}

function readProjectionNextAction(projection: Awaited<ReturnType<typeof loadForgeProjectProjection>>): string {
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
