import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { buildPhaseSkillPacket, renderPhaseSkillPacket } from "./phase-skill-packet";
import { renderForgeNextJson, renderForgeNextText } from "./render-next";
import { renderForgeSliceStatusText } from "./render-slice-status";
import { loadForgeProjectProjection, loadForgeSliceStatus } from "../vault/load-project";
import { readPositionalArgs } from "./arg-utils";

export async function forgeNextCommand(args: string[]): Promise<void> {
  await renderForgeProjection(args);
}

export async function forgeImproveCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  requireValue(project, "project");
  const phasePacket = buildPhaseSkillPacket("improvement-review", { project });
  if (json) printJson({ status: "ok", project, phasePacket });
  else printLine([`forge improve for ${project}: improvement-review`, "", renderPhaseSkillPacket(phasePacket)].join("\n"));
}

export async function forgeStatusCommand(args: string[]): Promise<void> {
  await renderForgeProjection(args);
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
