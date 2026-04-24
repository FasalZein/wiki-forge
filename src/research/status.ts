import { RESEARCH_STATUSES, RESEARCH_VERIFICATION_LEVELS, RESEARCH_WORKFLOW_STAGES, collectResearchStatus } from "./_shared";
import { printJson, printLine } from "../lib/cli-output";

export async function researchStatus(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const result = await collectResearchStatus(topic);
  if (json) printJson(result);
  else {
    printLine(`research status${result.topic ? ` for ${result.topic}` : ""}:`);
    printLine(`- root: ${result.root}`);
    printLine(`- pages: ${result.counts.total}`);
    printLine(`- missing sources: ${result.counts.missingSources}`);
    printLine(`- missing influence: ${result.counts.missingInfluence}`);
    printLine(`- stale unverified: ${result.counts.staleUnverified}`);
    printLine(`- ready to handoff: ${result.counts.readyToHandoff}`);
    printLine(`- status: ${RESEARCH_STATUSES.map((status) => `${status}=${result.byStatus[status] ?? 0}`).join(" ")}`);
    printLine(`- verification: ${RESEARCH_VERIFICATION_LEVELS.map((level) => `${level}=${result.byVerification[level] ?? 0}`).join(" ")}`);
    printLine(`- workflow: ${RESEARCH_WORKFLOW_STAGES.map((stage) => `${stage}=${result.workflow.byStage[stage] ?? 0}`).join(" ")}`);
    printLine(`- next handoff: ${result.workflow.nextCommand}`);
    if (result.workflow.canonicalTargets.length) {
      printLine(`- project-truth targets: ${result.workflow.canonicalTargets.join(", ")}`);
    }
  }
}

export { collectResearchStatus };
