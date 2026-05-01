import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { requireValue } from "../../cli-shared";
import { printJson, printLine } from "../../lib/cli-output";
import { readLatestForgeHandover, writeForgeHandover } from "./handover/store";
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
  const handoverStaleness = latestHandover ? detectHandoverPromptStaleness(latestHandover.copyPastePrompt, repo) : null;
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
      } else {
        printLine(`prompt: ${latestHandover.copyPastePrompt}`);
      }
    }
  }
}

export async function exportPromptCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base"]);
  const project = positional[0];
  requireValue(project, "project");
  const [statusTruth, latestHandover] = await Promise.all([
    loadForgeProjectProjection(project),
    readLatestForgeHandover(project),
  ]);
  const packet = buildPromptPacket({ project, statusTruth, latestHandover });
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
  const result = await writeForgeHandover({
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
  else {
    printLine(`wrote ${result.path}`);
    const preview = result.handover.summary.split("\n")[0]?.trim() ?? "";
    if (preview) printLine(`summary: ${preview}`);
    printLine("```text");
    printLine(result.handover.copyPastePrompt);
    printLine("```");
  }
}

type HandoverStaleness =
  | { readonly status: "not-stale" }
  | { readonly status: "unknown"; readonly reason: string }
  | { readonly status: "stale"; readonly promptHead: string; readonly currentHead: string };

function detectHandoverPromptStaleness(copyPastePrompt: string, repo: string): HandoverStaleness {
  const promptHead = readPromptHead(copyPastePrompt);
  if (!promptHead) return { status: "not-stale" };
  const currentHead = readGitHead(repo);
  if (!currentHead) return { status: "unknown", reason: "current HEAD unavailable" };
  if (currentHead.startsWith(promptHead) || promptHead.startsWith(currentHead)) return { status: "not-stale" };
  return { status: "stale", promptHead, currentHead };
}

function readPromptHead(copyPastePrompt: string): string | null {
  const match = /\b(?:HEAD|base)\s+([0-9a-f]{7,40})\b/i.exec(copyPastePrompt);
  return match?.[1] ?? null;
}

function readGitHead(repo: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(repo),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (error instanceof Error) return null;
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
