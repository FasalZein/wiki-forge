import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { gitHeadSha } from "../../git-utils";
import { evaluateTddGate } from "../lifecycle/tdd-gate";
import { readForgeEvidence, recordForgeReviewEvidence, recordForgeStrictTddEvidence, recordForgeVerificationEvidence } from "../vault/evidence-store";
import { completeForgeReviewSession, parseReviewSessionMode, startForgeReviewSession } from "../vault/review-session-store";
import { readFlagValue, readPositionalArgs, readRepeatedFlagValues } from "./arg-utils";

export async function forgeTddCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--test", "--command", "--red-command", "--green-command", "--note"]);
  const parsed = parseTddArgs(positional);
  const { action, project, sliceId } = parsed;
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");

  if (action === "status") {
    const gate = evaluateTddGate(await readForgeEvidence(project, sliceId), { project, sliceId });
    if (json) printJson(gate);
    else printLine(renderTddGateText(sliceId, gate));
    if (gate.status !== "passed") throw Object.assign(new Error(`TDD gate ${gate.status}`), { exitCode: 1 });
    return;
  }

  const testPaths = readRepeatedFlagValues(args, "--test");
  if (testPaths.length === 0) throw new Error("missing --test");

  if (action === "cycle") {
    const redCommand = readFlagValue(args, "--red-command");
    requireValue(redCommand, "--red-command");
    const greenCommand = readFlagValue(args, "--green-command");
    requireValue(greenCommand, "--green-command");
    const cycleId = `cycle-${Date.now().toString(36)}`;
    const redRecordedAt = new Date().toISOString();
    const greenRecordedAt = new Date(Date.parse(redRecordedAt) + 1).toISOString();
    const red = await recordForgeStrictTddEvidence({
      project,
      sliceId,
      phase: "red",
      command: redCommand,
      testPaths,
      result: "failed",
      note: readFlagValue(args, "--note"),
      cycleId,
      recordedAt: redRecordedAt,
    });
    const green = await recordForgeStrictTddEvidence({
      project,
      sliceId,
      phase: "green",
      command: greenCommand,
      testPaths,
      result: "passed",
      note: readFlagValue(args, "--note"),
      cycleId,
      recordedAt: greenRecordedAt,
    });
    if (json) printJson({ status: "recorded", cycleId, red, green });
    else printLine(`recorded TDD cycle evidence for ${sliceId}`);
    return;
  }

  if (action !== "red" && action !== "green") throw new Error(`unknown forge tdd subcommand: ${action}`);
  const command = readFlagValue(args, "--command");
  requireValue(command, "--command");
  const record = await recordForgeStrictTddEvidence({
    project,
    sliceId,
    phase: action,
    command,
    testPaths,
    result: action === "red" ? "failed" : "passed",
    note: readFlagValue(args, "--note"),
  });
  if (json) printJson(record);
  else printLine(`recorded TDD ${action} evidence for ${sliceId}`);
}

export async function forgeEvidenceCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  const kind = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  requireValue(kind, "evidence kind");
  const command = readFlagValue(args, "--command");
  requireValue(command, "--command");
  if (kind !== "verify" && kind !== "verification") throw new Error(`unknown forge evidence kind: ${kind}. Use 'verify' for targeted verification or 'wiki forge tdd cycle' for TDD evidence.`);
  const result = parseEvidenceResult(readFlagValue(args, "--result") ?? "passed");
  const record = await recordForgeVerificationEvidence({
    project,
    sliceId,
    command,
    result,
    verificationType: parseVerificationType(readFlagValue(args, "--verification-type") ?? "targeted"),
  });
  if (json) printJson(record);
  else printLine(`recorded ${record.kind} evidence for ${sliceId}`);
}

export async function forgeReviewCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const subcommand = positional[0];
  if (subcommand === "start") {
    const project = positional[1];
    const sliceId = positional[2];
    requireValue(project, "project");
    requireValue(sliceId, "slice-id");
    const reviewer = readFlagValue(args, "--reviewer");
    requireValue(reviewer, "--reviewer");
    const session = await startForgeReviewSession({
      project,
      sliceId,
      reviewer,
      mode: parseReviewSessionMode(readFlagValue(args, "--mode")),
    });
    if (json) printJson(session);
    else printLine(`started review session for ${sliceId}`);
    return;
  }
  if (subcommand !== "record") throw new Error(`unknown forge review subcommand: ${subcommand ?? ""}`);
  const project = positional[1];
  const sliceId = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const reviewer = readFlagValue(args, "--reviewer");
  requireValue(reviewer, "--reviewer");
  const repo = readFlagValue(args, "--repo");
  const head = repo ? await gitHeadSha(repo) : undefined;
  const verdict = parseReviewVerdict(readFlagValue(args, "--verdict") ?? "approved");
  const record = await recordForgeReviewEvidence({
    project,
    sliceId,
    reviewer,
    verdict,
    ...(head ? { git: { head } } : {}),
  });
  await completeForgeReviewSession({ project, sliceId, record });
  if (json) printJson(record);
  else printLine(`recorded review evidence for ${sliceId}`);
}

function parseTddArgs(positional: readonly string[]) {
  if (positional[0] === "status" || positional[0] === "red" || positional[0] === "green" || positional[0] === "cycle") {
    return { action: positional[0], project: positional[1], sliceId: positional[2] };
  }
  return { action: positional[2] ?? "status", project: positional[0], sliceId: positional[1] };
}

function parseEvidenceResult(value: string): "passed" | "failed" {
  if (value === "passed" || value === "failed") return value;
  throw new Error(`invalid evidence result: ${value}`);
}

function parseVerificationType(value: string): "targeted" | "full-suite" {
  if (value === "targeted" || value === "full-suite") return value;
  throw new Error(`invalid verification type: ${value}`);
}

function parseReviewVerdict(value: string): "approved" | "needs-changes" | "approved-with-followups" {
  const normalized = value.replaceAll("_", "-");
  if (normalized === "approved" || normalized === "needs-changes" || normalized === "approved-with-followups") return normalized;
  throw new Error(`invalid review verdict: ${value}`);
}

function renderTddGateText(sliceId: string, gate: ReturnType<typeof evaluateTddGate>): string {
  if (gate.status === "passed") return `${sliceId}: TDD gate passed`;
  if (gate.status === "invalid-sequence") return `${sliceId}: TDD gate blocked: ${gate.reason}\nnext: ${gate.recovery.command}`;
  return `${sliceId}: TDD gate ${gate.status}\nnext: ${gate.recovery.command}`;
}
