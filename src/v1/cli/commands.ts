import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { describeLegacyCommand } from "./legacy-compat";
import { renderForgeNextJson, renderForgeNextText } from "./render-forge-next";
import { loadV1ProjectProjection } from "../vault/load-project";

export async function v1ForgeNext(args: string[]): Promise<void> {
  await renderV1ForgeProjection(args);
}

export async function v1ForgeStatus(args: string[]): Promise<void> {
  await renderV1ForgeProjection(args);
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

async function renderV1ForgeProjection(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const projection = await loadV1ProjectProjection(project);
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
}
