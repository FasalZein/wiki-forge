import { readFlagValue } from "../../cli-shared";
import { printJson, printLine } from "../../lib/cli-output";
import { collectResearchLintResult } from "./_shared";

export async function lintResearch(args: string[]) {
  const topic = readResearchTopicArg(args);
  const project = readFlagValue(args, "--project");
  const json = args.includes("--json");
  const result = await collectResearchLintResult(topic, project);
  if (json) printJson(result);
  else if (result.issues.length) {
    printLine(`research lint found ${result.issues.length} issue(s)${result.topic ? ` for ${result.topic}` : ""}:`);
    for (const issue of result.issues) printLine(`- ${issue}`);
  } else printLine(`research lint passed${result.topic ? ` for ${result.topic}` : ""}`);
  if (result.issues.length) throw new Error(`research lint failed${result.topic ? ` for ${result.topic}` : ""}`);
}

function readResearchTopicArg(args: string[]) {
  const skipped = new Set<number>();
  const projectIndex = args.indexOf("--project");
  if (projectIndex >= 0) {
    skipped.add(projectIndex);
    skipped.add(projectIndex + 1);
  }
  return args.find((arg, index) => !skipped.has(index) && !arg.startsWith("--"));
}

export { collectResearchLintResult };
