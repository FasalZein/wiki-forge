import { RESEARCH_STATUSES, RESEARCH_VERIFICATION_LEVELS, RESEARCH_WORKFLOW_STAGES, collectResearchStatus } from "./_shared";

export async function researchStatus(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const result = await collectResearchStatus(topic);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`research status${result.topic ? ` for ${result.topic}` : ""}:`);
    console.log(`- root: ${result.root}`);
    console.log(`- pages: ${result.counts.total}`);
    console.log(`- missing sources: ${result.counts.missingSources}`);
    console.log(`- missing influence: ${result.counts.missingInfluence}`);
    console.log(`- stale unverified: ${result.counts.staleUnverified}`);
    console.log(`- ready to distill: ${result.counts.readyToDistill}`);
    console.log(`- status: ${RESEARCH_STATUSES.map((status) => `${status}=${result.byStatus[status] ?? 0}`).join(" ")}`);
    console.log(`- verification: ${RESEARCH_VERIFICATION_LEVELS.map((level) => `${level}=${result.byVerification[level] ?? 0}`).join(" ")}`);
    console.log(`- workflow: ${RESEARCH_WORKFLOW_STAGES.map((stage) => `${stage}=${result.workflow.byStage[stage] ?? 0}`).join(" ")}`);
    console.log(`- distill handoff: ${result.workflow.nextCommand}`);
    if (result.workflow.canonicalTargets.length) {
      console.log(`- project-truth targets: ${result.workflow.canonicalTargets.join(", ")}`);
    }
  }
}

export { collectResearchStatus };
