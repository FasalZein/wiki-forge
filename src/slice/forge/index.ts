import { relative } from "node:path"; // desloppify:ignore *
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { readFlagValue } from "../../lib/cli-utils";
import { exists, readText } from "../../lib/fs";
import { renderSteeringPacket } from "../../protocol/steering/index";
import type { ForgeWorkflowLedger } from "../../protocol/status/index";
import { projectTaskHubPath } from "../../lib/structure";
import { collectBacklogFocus, collectTaskContextForId } from "../../hierarchy";
// Legacy-only dependency while this module is being removed feature-by-feature.
// eslint-disable-next-line boundaries/dependencies
import { moveTaskToSection } from "../../hierarchy/backlog/io";
import { createFeatureReturningId, createPrdReturningId } from "../../hierarchy/planning/index";
import { appendLogEntry } from "../../lib/log";
import { collectForgeStatus, compactForgeStatusForJson, resolveTargetWorkflowSteering, resolveWorkflowSteering } from "../../protocol";
import { createIssueSlice } from "../docs/scaffold";
import { startSlice } from "../lifecycle/start";
import { runPipeline } from "../pipeline";
import { autoFillSliceDocs, buildSlicePromptData, forgeNextAll, renderSlicePrompt } from "./planning";
import { parseForgeArgs, parseForgeStatusArgs } from "./args";
import {
  applyPipelineFailureRecovery,
  applyResolvedSteering,
  renderForgePipeline,
  renderForgeStatus,
  renderForgeStatusWithoutSlice,
} from "./output";
import { collectForgeReview } from "./docs";
import { printError, printJson, printLine } from "../../lib/cli-output";
import { v1ForgeAmend, v1ForgeCheck, v1ForgeClose, v1ForgeEvidence, v1ForgeNext, v1ForgePlan, v1ForgeRelease, v1ForgeReview, v1ForgeRun, v1ForgeStart, v1ForgeStatus } from "../../v1/cli/commands";
import { shouldUseForgeNext, shouldUseForgeStatus } from "../../forge/cutover";
export { forgeSkip } from "./skip";


export async function forgeAmend(args: string[]) {
  await v1ForgeAmend(args);
}

export async function forgePlan(args: string[]) {
  await v1ForgePlan(args);
}

export async function forgeEvidence(args: string[]) {
  await v1ForgeEvidence(args);
}

export async function forgeReview(args: string[]) {
  await v1ForgeReview(args);
}

export async function forgeRun(args: string[]) {
  await v1ForgeRun(args);
}

export async function forgeStart(args: string[]) {
  await v1ForgeStart(args);
}

export async function forgeCheck(args: string[]) {
  await v1ForgeCheck(args);
}

export async function forgeClose(args: string[]) {
  await v1ForgeClose(args);
}

export async function forgeStatus(args: string[]) {
  if (shouldUseForgeStatus(args)) {
    await v1ForgeStatus(args);
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
  await v1ForgeRelease(args);
}

async function legacyForgePlan(args: string[]) {
  const parsed = parseForgePlanArgs(args);
  let createdFeatureId: string | undefined;
  let createdPrdId: string | undefined;
  const createdSliceIds: string[] = [];
  let lastStep = "parse";
  try {
    lastStep = "create-feature";
    const featureId = parsed.featureId ?? await (async () => {
      requireValue(parsed.featureName, "feature-name (positional) or --feature FEAT-xxx");
      const { specId } = await createFeatureReturningId(parsed.project, parsed.featureName!);
      printLine(`created feature ${specId}`);
      createdFeatureId = specId;
      return specId;
    })();
    if (!createdFeatureId) createdFeatureId = featureId;
    const prdName = parsed.prdName ?? parsed.featureName;
    requireValue(prdName, "prd-name (--prd-name) or feature-name positional");
    lastStep = "create-prd";
    const { specId: prdId } = await createPrdReturningId(parsed.project, prdName!, featureId);
    printLine(`created prd ${prdId}`);
    createdPrdId = prdId;

    if (parsed.slices.length > 0) {
      // Multi-slice path
      for (let i = 0; i < parsed.slices.length; i += 1) {
        const sliceTitle = parsed.slices[i];
        lastStep = `create-slice-${i + 1}`;
        const sliceArgs = [
          parsed.project,
          sliceTitle,
          "--prd", prdId,
          ...(parsed.agent ? ["--assignee", parsed.agent] : []),
        ];
        const slice = await createIssueSlice(sliceArgs);
        if (!slice) throw new Error(`createIssueSlice did not return a result for slice ${i + 1}`);
        printLine(`created slice ${slice.taskId}`);
        createdSliceIds.push(slice.taskId);

        if (i > 0) {
          const previousSliceId = createdSliceIds[i - 1];
          await patchSliceDependsOn(parsed.project, slice.taskId, previousSliceId);
        }

        if (i === 0) {
          lastStep = "start-slice";
          await startSlice([
            parsed.project,
            slice.taskId,
            ...(parsed.agent ? ["--agent", parsed.agent] : []),
            ...(parsed.repo ? ["--repo", parsed.repo] : []),
          ]);
        }

        lastStep = `autofill-docs-${i + 1}`;
        await autoFillSliceDocs(parsed.project, slice.taskId, prdId);
      }
      const [startedId, ...pendingIds] = createdSliceIds;
      const pendingSummary = pendingIds.length ? `; pending: ${pendingIds.join(", ")}` : "";
      printLine(`started ${startedId}${pendingSummary}`);
    } else {
      // Single-slice path (original behavior)
      lastStep = "create-slice";
      const sliceTitle = parsed.title ?? prdName!;
      const sliceArgs = [
        parsed.project,
        sliceTitle,
        "--prd", prdId,
        ...(parsed.agent ? ["--assignee", parsed.agent] : []),
      ];
      const slice = await createIssueSlice(sliceArgs);
      if (!slice) throw new Error("createIssueSlice did not return a result");
      printLine(`created slice ${slice.taskId}`);
      createdSliceIds.push(slice.taskId);
      lastStep = "start-slice";
      await startSlice([
        parsed.project,
        slice.taskId,
        ...(parsed.agent ? ["--agent", parsed.agent] : []),
        ...(parsed.repo ? ["--repo", parsed.repo] : []),
      ]);
      lastStep = "autofill-docs";
      await autoFillSliceDocs(parsed.project, slice.taskId, prdId);
    }
  } catch (error) {
    const artifacts: string[] = [];
    if (createdFeatureId) artifacts.push(`  feature: ${createdFeatureId}`);
    if (createdPrdId) artifacts.push(`  prd: ${createdPrdId}`);
    for (const sliceId of createdSliceIds) artifacts.push(`  slice: ${sliceId}`);
    if (artifacts.length) {
      printError(`forge plan failed at ${lastStep}. Already created:\n${artifacts.join("\n")}`);
      if (createdSliceIds.length) printError(`Use: wiki forge start ${parsed.project} ${createdSliceIds[0]} to retry from start-slice`);
    }
    throw error;
  }
}

async function patchSliceDependsOn(project: string, sliceId: string, dependsOnSliceId: string): Promise<void> {
  const indexPath = projectTaskHubPath(project, sliceId);
  const raw = await readText(indexPath);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), raw, { silent: true });
  if (!parsed) return;
  const updatedData = orderFrontmatter(
    { ...parsed.data, depends_on: [dependsOnSliceId], updated: nowIso() },
    ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"],
  );
  writeNormalizedPage(indexPath, parsed.content, updatedData);
}

type ForgePlanArgs = {
  project: string;
  featureName: string | undefined;
  featureId: string | undefined;
  prdName: string | undefined;
  title: string | undefined;
  slices: string[];
  agent: string | undefined;
  repo: string | undefined;
};

function parseForgePlanArgs(args: string[]): ForgePlanArgs {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let prdName: string | undefined;
  let title: string | undefined;
  let slices: string[] = [];
  let agent: string | undefined;
  let repo: string | undefined;
  const nameParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--feature":
        featureId = args[index + 1];
        index += 1;
        break;
      case "--prd-name":
        prdName = args[index + 1];
        index += 1;
        break;
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--slices": {
        const raw = args[index + 1] ?? "";
        slices = raw.split(",").map((s) => s.trim()).filter(Boolean);
        index += 1;
        break;
      }
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--repo":
        repo = args[index + 1];
        index += 1;
        break;
      default:
        if (!arg.startsWith("--")) nameParts.push(arg);
        break;
    }
  }
  const featureName = nameParts.join(" ").trim() || undefined;
  if (!featureId && !featureName) throw new Error("feature-name (positional) or --feature FEAT-xxx is required");
  return { project, featureName, featureId, prdName, title, slices, agent, repo };
}

export async function forgeNext(args: string[]) {
  if (shouldUseForgeNext(args)) {
    await v1ForgeNext(args);
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


