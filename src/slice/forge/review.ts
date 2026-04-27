import { requireValue } from "../../cli-shared";
import { readFlagValue, readFlagValues } from "../../lib/cli-utils";
import { printJson, printLine } from "../../lib/cli-output";
import { isReviewVerdict, recordForgeReview } from "../../forge/core/reviews";

export function parseForgeReviewRecordArgs(args: string[]) {
  const positional = args.filter((arg, index) => !arg.startsWith("--") && !["--verdict", "--reviewer", "--model", "--artifact", "--blocker", "--repo"].includes(args[index - 1] ?? ""));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const verdict = readFlagValue(args, "--verdict");
  const reviewer = readFlagValue(args, "--reviewer");
  requireValue(verdict, "verdict");
  requireValue(reviewer, "reviewer");
  if (!isReviewVerdict(verdict)) throw new Error("invalid review verdict. Valid verdicts: approved, needs_changes, approved_with_followups");
  return {
    project,
    sliceId,
    verdict,
    reviewer,
    model: readFlagValue(args, "--model"),
    artifact: readFlagValue(args, "--artifact"),
    blockers: readFlagValues(args, "--blocker").map((value) => value.trim()).filter(Boolean),
    repo: readFlagValue(args, "--repo"),
    json: args.includes("--json"),
  };
}

export async function forgeReview(args: string[]) {
  const [subcommand, ...rest] = args;
  if (subcommand !== "record") throw new Error("unknown forge review subcommand. Usage: wiki forge review record <project> <slice-id> --verdict approved|needs_changes|approved_with_followups --reviewer <name>");
  const parsed = parseForgeReviewRecordArgs(rest);
  const recorded = await recordForgeReview(parsed);
  if (parsed.json) printJson({ project: parsed.project, sliceId: parsed.sliceId, recorded });
  else printLine(`recorded review evidence for ${parsed.sliceId}: ${recorded.verdict} by ${recorded.reviewer}`);
}
