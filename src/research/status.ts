import { RESEARCH_STATUSES, RESEARCH_VERIFICATION_LEVELS, collectResearchStatus } from "./_shared";

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
    console.log(`- stale unverified: ${result.counts.staleUnverified}`);
    console.log(`- status: ${RESEARCH_STATUSES.map((status) => `${status}=${result.byStatus[status] ?? 0}`).join(" ")}`);
    console.log(`- verification: ${RESEARCH_VERIFICATION_LEVELS.map((level) => `${level}=${result.byVerification[level] ?? 0}`).join(" ")}`);
  }
}

export { collectResearchStatus };
