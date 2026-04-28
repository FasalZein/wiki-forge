import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { describeLegacyCommand } from "./legacy-compat";
import { renderForgeNextJson, renderForgeNextText } from "./render-forge-next";
import { loadV1ProjectProjection } from "../vault/load-project";
import { releaseV1Slice, startV1Slice } from "../vault/slice-store";

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
