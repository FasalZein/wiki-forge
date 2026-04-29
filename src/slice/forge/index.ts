import { requireValue } from "../../cli-shared";
import { readFlagValue } from "../../lib/cli-utils";
import { renderSteeringPacket } from "../../protocol/steering/index";
import { collectBacklogFocus } from "../../hierarchy";
import { collectForgeStatus, compactForgeStatusForJson, resolveTargetWorkflowSteering, resolveWorkflowSteering } from "../../protocol";
import { buildSlicePromptData, forgeNextAll, renderSlicePrompt } from "./planning";
import { parseForgeStatusArgs } from "./args";
import {
  applyResolvedSteering,
  renderForgeStatus,
  renderForgeStatusWithoutSlice,
} from "./output";
import { printJson, printLine } from "../../lib/cli-output";
import { forgeAmendCommand, forgeCheckCommand, forgeCloseCommand, forgeEvidenceCommand, forgeNextCommand, forgePlanCommand, forgeReleaseCommand, forgeReviewCommand, forgeRunCommand, forgeStartCommand, forgeStatusCommand } from "../../forge/workflow/commands";
import { shouldUseForgeNext, shouldUseForgeStatus } from "../../forge/cutover";
export { forgeSkip } from "./skip";


export async function forgeAmend(args: string[]) {
  await forgeAmendCommand(args);
}

export async function forgePlan(args: string[]) {
  await forgePlanCommand(args);
}

export async function forgeEvidence(args: string[]) {
  await forgeEvidenceCommand(args);
}

export async function forgeReview(args: string[]) {
  await forgeReviewCommand(args);
}

export async function forgeRun(args: string[]) {
  await forgeRunCommand(args);
}

export async function forgeStart(args: string[]) {
  await forgeStartCommand(args);
}

export async function forgeCheck(args: string[]) {
  await forgeCheckCommand(args);
}

export async function forgeClose(args: string[]) {
  await forgeCloseCommand(args);
}

export async function forgeStatus(args: string[]) {
  if (shouldUseForgeStatus(args)) {
    await forgeStatusCommand(args);
    return;
  }
  const parsed = await parseForgeStatusArgs(args);
  const focus = await collectBacklogFocus(parsed.project);
  if (!parsed.sliceId) {
    const resolution = await resolveWorkflowSteering(parsed.project, {
      repo: parsed.repo ?? process.cwd(),
      base: parsed.base,
      focus,
    });
    if (!resolution.workflow || !resolution.focusTask) {
      const payload = {
        project: parsed.project,
        sliceId: null,
        activeSlice: focus.activeTask?.id ?? null,
        recommendedSlice: focus.recommendedTask?.id ?? null,
        triage: resolution.triage,
        steering: resolution.steering,
      };
      if (parsed.json) printJson(payload);
      else renderForgeStatusWithoutSlice(payload);
      return;
    }
    const workflow = applyResolvedSteering(resolution.workflow, resolution.triage, resolution.steering);
    if (parsed.json) printJson(compactForgeStatusForJson(workflow));
    else renderForgeStatus(workflow);
    return;
  }
  const resolution = await resolveTargetWorkflowSteering(parsed.project, {
    repo: parsed.repo ?? process.cwd(),
    sliceId: parsed.sliceId,
    base: parsed.base,
    focus,
  });
  const workflow = applyResolvedSteering(resolution.workflow, resolution.triage, resolution.steering);
  if (parsed.json) printJson(compactForgeStatusForJson(workflow));
  else renderForgeStatus(workflow);
}

export async function forgeOpen(args: string[]) {
  return forgeStart(args);
}

export async function forgeRelease(args: string[]) {
  await forgeReleaseCommand(args);
}

export async function forgeNext(args: string[]) {
  if (shouldUseForgeNext(args)) {
    await forgeNextCommand(args);
    return;
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const promptFlag = args.includes("--prompt");
  const promptJson = args.includes("--prompt-json");
  const all = args.includes("--all");
  const repo = readFlagValue(args, "--repo");

  if (all && !promptJson) {
    throw new Error("--all requires --prompt-json");
  }

  if (all && promptJson) {
    await forgeNextAll(project);
    return;
  }

  const focus = await collectBacklogFocus(project);
  const steeringResolution = await resolveWorkflowSteering(project, {
    repo: repo ?? process.cwd(),
    focus,
  });

  const activeId = steeringResolution.focus.activeTask?.id ?? null;
  const targetId = steeringResolution.focusTask?.id ?? null;

  if (!targetId) {
    if (json || promptJson) printJson({ project, targetSlice: null, action: "no ready slices" });
    else printLine(`no ready slices for ${project}`);
    return;
  }

  const workflow = steeringResolution.workflow ?? await collectForgeStatus(project, targetId, repo);

  if (promptJson || promptFlag) {
    const promptData = await buildSlicePromptData(project, targetId, workflow, activeId !== null);
    if (promptJson) {
      printJson(promptData);
    } else {
      printLine(renderSlicePrompt(promptData));
    }
    return;
  }

  const result = {
    project,
    targetSlice: targetId,
    active: activeId !== null,
    triage: steeringResolution.triage,
    steering: steeringResolution.steering,
    planStatus: steeringResolution.focusTask?.planStatus ?? workflow.planStatus,
    testPlanStatus: steeringResolution.focusTask?.testPlanStatus ?? workflow.testPlanStatus,
    verificationLevel: steeringResolution.verificationLevel ?? workflow.verificationLevel,
  };

  if (json) printJson(result);
  else {
    printLine(`forge next for ${project}: ${targetId}`);
    for (const line of renderSteeringPacket(steeringResolution.steering)) printLine(`- ${line}`);
    printLine(`- ${activeId ? "active" : "recommended"} slice`);
    printLine(`- plan: ${result.planStatus}`);
    printLine(`- test-plan: ${result.testPlanStatus}`);
    printLine(`- verification: ${result.verificationLevel ?? "none"}`);
    if (steeringResolution.triage.command !== steeringResolution.steering.nextCommand) {
      printLine(`- next action: ${steeringResolution.triage.command}`);
      printLine(`  reason: ${steeringResolution.triage.reason}`);
    }
  }
}


