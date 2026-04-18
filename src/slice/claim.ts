import { fail, requireValue } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { collectClaimResult, defaultAgentName, formatClaimConflictError, writeClaimMetadata } from "./_shared";

export async function claimSlice(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  let agent = defaultAgentName();
  let repo: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--agent":
        agent = args[index + 1] || agent;
        index += 1;
        break;
      case "--repo":
        repo = args[index + 1] || undefined;
        index += 1;
        break;
      case "--json":
        break;
    }
  }

  const result = await collectClaimResult(project, sliceId, agent, repo);
  if (result.blockedBy.length > 0) {
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    fail(`${sliceId} is blocked by unfinished dependencies: ${result.blockedBy.join(", ")}`);
  }
  if (result.conflicts.length > 0) {
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    fail(formatClaimConflictError(sliceId, result.conflicts, project, repo));
  }
  await writeClaimMetadata(project, sliceId, agent, result.claimedAt!, result.sourcePaths);
  appendLogEntry("claim", sliceId, { project, details: [`agent=${agent}`, `paths=${result.sourcePaths.length}`] });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(`claimed ${sliceId} for ${agent}`);
}
