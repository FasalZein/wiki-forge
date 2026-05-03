import { readFlagValue } from "../../cli-shared";
import { collectResearchAudit } from "../../lib/research-audit";
import { collectResearchLintResult } from "./_shared";
import { printJson, printLine } from "../../lib/cli-output";

export async function auditResearch(args: string[]) {
  const topic = readResearchTopicArg(args);
  const project = readFlagValue(args, "--project");
  const json = args.includes("--json");
  const liveNetwork = args.includes("--live-network") || process.env.WIKI_LIVE_NETWORK_TESTS === "1";
  const [audit, lint] = await Promise.all([collectResearchAudit(topic, { liveNetwork, project }), collectResearchLintResult(topic, project)]);
  const result = { ...audit, lintIssues: lint.issues };
  if (json) {
    printJson(result);
    if (result.deadLinks.length || result.invalidInfluence.length || result.missingInfluence.length || lint.issues.length) throw new Error(`research audit failed${topic ? ` for ${topic}` : ""}`);
    return;
  }
  printLine(`research audit${result.topic ? ` for ${result.topic}` : ""}:`);
  printLine(`- root: ${result.root}`);
  printLine(`- pages: ${result.counts.pages}`);
  printLine(`- dead links: ${result.counts.deadLinks}`);
  printLine(`- missing influence: ${result.counts.missingInfluence}`);
  printLine(`- invalid influence: ${result.counts.invalidInfluence}`);
  printLine(`- stale unverified: ${result.counts.staleUnverified}`);
  printLine(`- lint issues: ${lint.issues.length}`);
  for (const link of result.deadLinks.slice(0, 10)) printLine(`  - dead link: ${link.page} -> ${link.url} (${link.message})`);
  for (const page of result.missingInfluence.slice(0, 10)) printLine(`  - missing influence: ${page}`);
  for (const issue of result.invalidInfluence.slice(0, 10)) printLine(`  - invalid influence: ${issue.page} -> ${issue.target}`);
  for (const issue of lint.issues.slice(0, 10)) printLine(`  - lint: ${issue}`);
  if (result.deadLinks.length || result.invalidInfluence.length || result.missingInfluence.length || lint.issues.length) throw new Error(`research audit failed${topic ? ` for ${topic}` : ""}`);
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
