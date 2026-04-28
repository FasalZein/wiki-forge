import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { describeLegacyCommand } from "./legacy-compat";
import { renderForgeNextJson, renderForgeNextText } from "./render-forge-next";
import { loadV1ProjectProjection } from "../vault/load-project";
import { releaseV1Slice, startV1Slice } from "../vault/slice-store";
import { recordV1ReviewEvidence, recordV1TddEvidence, recordV1VerificationEvidence } from "../vault/evidence-store";

export async function v1ForgeNext(args: string[]): Promise<void> {
  await renderV1ForgeProjection(args);
}

export async function v1ForgeStatus(args: string[]): Promise<void> {
  await renderV1ForgeProjection(args);
}

export async function v1ForgeStart(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const agent = readFlagValue(args, "--agent") ?? "agent";
  const result = await startV1Slice({ project, sliceId, agent });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `started ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function v1ForgeRelease(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const result = await releaseV1Slice({ project, sliceId });
  if (json) printJson(result);
  else printLine(`released ${sliceId}`);
}

export async function v1ForgeEvidence(args: string[]): Promise<void> {
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
  const result = parseEvidenceResult(readFlagValue(args, "--result") ?? "passed");
  const record = kind === "tdd"
    ? await recordV1TddEvidence({ project, sliceId, command, result })
    : await recordV1VerificationEvidence({
      project,
      sliceId,
      command,
      result,
      verificationType: parseVerificationType(readFlagValue(args, "--verification-type") ?? "targeted"),
    });
  if (json) printJson(record);
  else printLine(`recorded ${record.kind} evidence for ${sliceId}`);
}

export async function v1ForgeReview(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const subcommand = positional[0];
  if (subcommand !== "record") throw new Error(`unknown v1 forge review subcommand: ${subcommand ?? ""}`);
  const project = positional[1];
  const sliceId = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const reviewer = readFlagValue(args, "--reviewer");
  requireValue(reviewer, "--reviewer");
  const record = await recordV1ReviewEvidence({
    project,
    sliceId,
    reviewer,
    verdict: parseReviewVerdict(readFlagValue(args, "--verdict") ?? "approved"),
  });
  if (json) printJson(record);
  else printLine(`recorded review evidence for ${sliceId}`);
}

export function v1Compat(args: string[]): void {
  const json = args.includes("--json");
  const command = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  requireValue(command, "legacy command");
  const compatibility = describeLegacyCommand(command);
  if (json) printJson(compatibility);
  else {
    printLine(`${compatibility.command}: ${compatibility.status}`);
    if (compatibility.replacement) printLine(`replacement: ${compatibility.replacement}`);
    printLine(`reason: ${compatibility.reason}`);
  }
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

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function renderV1ForgeProjection(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const projection = await loadV1ProjectProjection(project);
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
}
