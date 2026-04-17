import { collectResearchAudit } from "../lib/research-audit";
import { collectResearchLintResult } from "./_shared";

export async function auditResearch(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const [audit, lint] = await Promise.all([collectResearchAudit(topic), collectResearchLintResult(topic)]);
  const result = { ...audit, lintIssues: lint.issues };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    if (result.deadLinks.length || result.invalidInfluence.length || result.missingInfluence.length || lint.issues.length) throw new Error(`research audit failed${topic ? ` for ${topic}` : ""}`);
    return;
  }
  console.log(`research audit${result.topic ? ` for ${result.topic}` : ""}:`);
  console.log(`- root: ${result.root}`);
  console.log(`- pages: ${result.counts.pages}`);
  console.log(`- dead links: ${result.counts.deadLinks}`);
  console.log(`- missing influence: ${result.counts.missingInfluence}`);
  console.log(`- invalid influence: ${result.counts.invalidInfluence}`);
  console.log(`- stale unverified: ${result.counts.staleUnverified}`);
  console.log(`- lint issues: ${lint.issues.length}`);
  for (const link of result.deadLinks.slice(0, 10)) console.log(`  - dead link: ${link.page} -> ${link.url} (${link.message})`);
  for (const page of result.missingInfluence.slice(0, 10)) console.log(`  - missing influence: ${page}`);
  for (const issue of result.invalidInfluence.slice(0, 10)) console.log(`  - invalid influence: ${issue.page} -> ${issue.target}`);
  for (const issue of lint.issues.slice(0, 10)) console.log(`  - lint: ${issue}`);
  if (result.deadLinks.length || result.invalidInfluence.length || result.missingInfluence.length || lint.issues.length) throw new Error(`research audit failed${topic ? ` for ${topic}` : ""}`);
}
