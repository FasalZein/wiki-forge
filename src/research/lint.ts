import { collectResearchLintResult } from "./_shared";
import { printJson, printLine } from "../lib/cli-output";

export async function lintResearch(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const result = await collectResearchLintResult(topic);
  if (json) printJson(result);
  else if (result.issues.length) {
    printLine(`research lint found ${result.issues.length} issue(s)${result.topic ? ` for ${result.topic}` : ""}:`);
    for (const issue of result.issues) printLine(`- ${issue}`);
  } else printLine(`research lint passed${result.topic ? ` for ${result.topic}` : ""}`);
  if (result.issues.length) throw new Error(`research lint failed${result.topic ? ` for ${result.topic}` : ""}`);
}

export { collectResearchLintResult };
