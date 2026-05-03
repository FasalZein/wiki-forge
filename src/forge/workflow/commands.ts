import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { renderForgeNextJson, renderForgeNextText } from "./render-next";
import { renderForgeSliceStatusText } from "./render-slice-status";
import { loadForgeProjectProjection, loadForgeSliceStatus } from "../vault/load-project";
import { amendForgeSlice, checkForgeSliceClose, closeForgeSlice, releaseForgeSlice, startForgeSlice } from "../vault/slice-store";
import { readForgeEvidence, recordForgeReviewEvidence, recordForgeStrictTddEvidence, recordForgeVerificationEvidence } from "../vault/evidence-store";
import { evaluateTddGate } from "../lifecycle/tdd-gate";

export { forgePlanCommand } from "./plan-command";

export async function forgeNextCommand(args: string[]): Promise<void> {
  await renderForgeProjection(args);
}

export async function forgeStatusCommand(args: string[]): Promise<void> {
  await renderForgeProjection(args);
}

export async function forgeStartCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const agent = readFlagValue(args, "--agent") ?? "agent";
  const result = await startForgeSlice({ project, sliceId, agent });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `started ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function forgeReleaseCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const result = await releaseForgeSlice({ project, sliceId });
  if (json) printJson(result);
  else printLine(`released ${sliceId}`);
}

export async function forgeAmendCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const options = parseAmendArgs(args);
  const result = await amendForgeSlice(options);
  if (json) printJson(result);
  else printLine(`created amendment ${result.amendmentSliceId} for ${result.closedSliceId}`);
}

export async function forgeCheckCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const closedBy = readFlagValue(args, "--closed-by") ?? readFlagValue(args, "--agent") ?? "agent";
  const result = await checkForgeSliceClose({ project, sliceId, closedBy });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `check passed ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function forgeCloseCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const closedBy = readFlagValue(args, "--closed-by") ?? readFlagValue(args, "--agent") ?? "agent";
  const result = await closeForgeSlice({ project, sliceId, closedBy });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `closed ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function forgeRunCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--agent", "--closed-by"]);
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  const agent = readFlagValue(args, "--agent") ?? readFlagValue(args, "--closed-by") ?? "agent";
  if (sliceId) {
    await forgeCloseCommand(args);
    return;
  }

  const projection = await loadForgeProjectProjection(project);
  if (projection.status === "active") {
    const result = await closeForgeSlice({ project, sliceId: projection.activeSliceId, closedBy: agent });
    if (json) printJson(result);
    else printLine(result.status === "accepted" ? `closed ${projection.activeSliceId}` : `rejected ${result.rejection.code}`);
    if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
    return;
  }
  if (projection.status === "ready") {
    const result = await startForgeSlice({ project, sliceId: projection.nextSliceId, agent });
    if (json) printJson(result);
    else printLine(result.status === "accepted" ? `started ${projection.nextSliceId}` : `rejected ${result.rejection.code}`);
    if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
    return;
  }
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
  if (projection.status === "conflict" || projection.status === "needs-repair") throw Object.assign(new Error(`cannot run ${project}: ${projection.status}`), { exitCode: 1 });
}

export async function forgeTddCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--test", "--command", "--note"]);
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

  if (action !== "red" && action !== "green") throw new Error(`unknown forge tdd subcommand: ${action}`);
  const command = readFlagValue(args, "--command");
  requireValue(command, "--command");
  const testPaths = readRepeatedFlagValues(args, "--test");
  if (testPaths.length === 0) throw new Error("missing --test");
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
  if (kind !== "verify" && kind !== "verification") throw new Error(`unknown forge evidence kind: ${kind}. Use 'verify' for targeted verification or 'wiki forge tdd red/green' for TDD evidence.`);
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
  if (subcommand !== "record") throw new Error(`unknown forge review subcommand: ${subcommand ?? ""}`);
  const project = positional[1];
  const sliceId = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const reviewer = readFlagValue(args, "--reviewer");
  requireValue(reviewer, "--reviewer");
  const record = await recordForgeReviewEvidence({
    project,
    sliceId,
    reviewer,
    verdict: parseReviewVerdict(readFlagValue(args, "--verdict") ?? "approved"),
  });
  if (json) printJson(record);
  else printLine(`recorded review evidence for ${sliceId}`);
}

function parseTddArgs(positional: readonly string[]) {
  if (positional[0] === "status" || positional[0] === "red" || positional[0] === "green") {
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

function parseAmendArgs(args: readonly string[]) {
  const positional: string[] = [];
  const sourcePaths: string[] = [];
  let reason: string | undefined;
  let title: string | undefined;
  let agent: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--reason":
        reason = args[index + 1];
        index += 1;
        break;
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--source":
        while (args[index + 1] && !args[index + 1]?.startsWith("--")) {
          sourcePaths.push(String(args[index + 1]).replaceAll("\\", "/"));
          index += 1;
        }
        break;
      case "--json":
      case "--start":
        break;
      default:
        if (!arg.startsWith("--")) positional.push(arg);
        break;
    }
  }
  const project = positional[0];
  const closedSliceId = positional[1];
  requireValue(project, "project");
  requireValue(closedSliceId, "closed-slice-id");
  requireValue(reason, "--reason");
  return {
    project,
    closedSliceId,
    reason,
    ...(title ? { title } : {}),
    ...(agent ? { agent } : {}),
    sourcePaths,
    start: args.includes("--start"),
  };
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
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing ${flag}`);
    values.push(value.replaceAll("\\", "/"));
    index += 1;
  }
  return values;
}

function renderTddGateText(sliceId: string, gate: ReturnType<typeof evaluateTddGate>): string {
  if (gate.status === "passed") return `${sliceId}: TDD gate passed`;
  if (gate.status === "invalid-sequence") return `${sliceId}: TDD gate blocked: ${gate.reason}\nnext: ${gate.recovery.command}`;
  return `${sliceId}: TDD gate ${gate.status}\nnext: ${gate.recovery.command}`;
}

async function renderForgeProjection(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base", "--agent", "--closed-by"]);
  const project = positional[0];
  requireValue(project, "project");
  const sliceId = positional[1];
  if (sliceId) {
    const status = await loadForgeSliceStatus(project, sliceId);
    if (json) printJson(status);
    else printLine(renderForgeSliceStatusText(status));
    return;
  }
  const projection = await loadForgeProjectProjection(project);
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
}
