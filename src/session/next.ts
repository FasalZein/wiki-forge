import { requireValue } from "../cli-shared";
import { assertGitRepo, resolveRepoPath } from "../lib/verification";
import { collectBacklogFocus } from "../hierarchy";
import { collectMaintenancePlan } from "../maintenance";
import { resolveDefaultBase } from "../git-utils";

export async function nextProject(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const focus = await collectBacklogFocus(project);
  // Only recommend a slice if its hub (index.md) is scaffolded; unscaffolded slices cannot be started
  const scaffoldedRecommendation = focus.recommendedTask?.taskHubPath !== undefined ? focus.recommendedTask : null;
  const recommendation = focus.activeTask
    ? { ...focus.activeTask, reason: "continue the active slice" }
    : scaffoldedRecommendation
      ? { ...scaffoldedRecommendation, reason: "next ready slice from backlog" }
      : null;

  let actions: Array<{ kind: string; message: string }> = [];
  let repo: string | undefined;
  let base: string | undefined;
  try {
    repo = await resolveRepoPath(project);
    await assertGitRepo(repo);
    base = await resolveDefaultBase(project, repo);
    actions = (await collectMaintenancePlan(project, base, repo)).actions.slice(0, 5);
  } catch {}

  const result = { project, repo, base, recommendation, warnings: focus.warnings, actions };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!recommendation) {
    console.log(`no ready slice found for ${project}`);
    return;
  }
  console.log(`${recommendation.id} ${recommendation.title}`);
  console.log(`- ${recommendation.reason}`);
  if (recommendation.hasSliceDocs) console.log(`- plan=${recommendation.planStatus} test-plan=${recommendation.testPlanStatus}`);
  for (const warning of focus.warnings) console.log(`- warning: ${warning}`);
  for (const action of actions) console.log(`- ${action.kind}: ${action.message}`);
}
