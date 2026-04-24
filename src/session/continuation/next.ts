import { requireValue } from "../../cli-shared";
import { readFlagValue } from "../../lib/cli-utils";
import { renderSteeringPacket } from "../../protocol/steering/index";
import { resolveWorkflowSteering } from "../../protocol";
import { assertGitRepo, resolveRepoPath } from "../../lib/verification";
import { collectBacklogFocus } from "../../hierarchy";
import { collectMaintenancePlan } from "../../maintenance";
import { resolveDefaultBase } from "../../git-utils";
import { printJson, printLine } from "../../lib/cli-output";

export async function nextProject(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const repoFlag = readFlagValue(args, "--repo");
  const focus = await collectBacklogFocus(project);
  // Only recommend a slice if its hub (index.md) is scaffolded; unscaffolded slices cannot be started
  const scaffoldedRecommendation = focus.recommendedTask?.taskHubPath !== undefined ? focus.recommendedTask : null;
  const recommendation = focus.activeTask
    ? { ...focus.activeTask, reason: "continue the active slice" }
    : scaffoldedRecommendation
      ? { ...scaffoldedRecommendation, reason: "next queued slice from backlog" }
      : null;

  let actions: Array<{ kind: string; message: string }> = [];
  let repo: string | undefined;
  let base: string | undefined;
  let triage:
    | Awaited<ReturnType<typeof resolveWorkflowSteering>>["triage"]
    | undefined;
  let steering:
    | Awaited<ReturnType<typeof resolveWorkflowSteering>>["steering"]
    | undefined;
  try {
    repo = await resolveRepoPath(project, repoFlag);
    await assertGitRepo(repo);
    base = await resolveDefaultBase(project, repo);
    actions = (await collectMaintenancePlan(project, base, repo)).actions.slice(0, 5);
    const steeringResolution = await resolveWorkflowSteering(project, {
      repo,
      base,
      focus,
    });
    triage = steeringResolution.triage;
    steering = steeringResolution.steering;
  } catch {}

  const result = {
    project,
    repo,
    base,
    recommendation,
    warnings: focus.warnings,
    actions,
    ...(triage ? { triage } : {}),
    ...(steering ? { steering } : {}),
  };
  if (json) {
    printJson(result);
    return;
  }
  if (!recommendation) {
    printLine(`no ready slice found for ${project}`);
    return;
  }
  printLine(`${recommendation.id} ${recommendation.title}`);
  printLine(`- ${recommendation.reason}`);
  if (recommendation.hasSliceDocs) printLine(`- plan=${recommendation.planStatus} test-plan=${recommendation.testPlanStatus}`);
  if (steering) {
    for (const line of renderSteeringPacket(steering)) printLine(`- ${line}`);
  }
  for (const warning of focus.warnings) printLine(`- warning: ${warning}`);
  for (const action of actions) printLine(`- ${action.kind}: ${action.message}`);
}
