import { collectResearchLintResult } from "./_shared";

export async function lintResearch(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const result = await collectResearchLintResult(topic);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.issues.length) {
    console.log(`research lint found ${result.issues.length} issue(s)${result.topic ? ` for ${result.topic}` : ""}:`);
    for (const issue of result.issues) console.log(`- ${issue}`);
  } else console.log(`research lint passed${result.topic ? ` for ${result.topic}` : ""}`);
  if (result.issues.length) throw new Error(`research lint failed${result.topic ? ` for ${result.topic}` : ""}`);
}

export { collectResearchLintResult };
