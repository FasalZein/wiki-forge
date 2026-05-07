import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { appendLogEntry } from "../../lib/log";
import { createResearchPage } from "../research";
import { assertGlobalResearchAllowed, assertProjectExists, isResearchRoutingFlag, readResearchProjectRouting } from "../research/project-routing";
import { buildAnswerBrief } from "./answer-brief";
import { fileAnswerBrief } from "./answer-filing";
import { parseAskOptions } from "./answer-request";
import { renderAnswerBrief } from "./answer-rendering";
import { printLine } from "../../lib/cli-output";

export { DEFAULT_ASK_MAX_RESULTS, resolveAnswerRetrievalStrategy, resolveAskCandidateLimit } from "./answer-brief";

export async function askProject(args: string[]) {
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  printLine(renderAnswerBrief(brief, { verbose: options.verbose }));
}

export async function fileAnswer(args: string[]) {
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  const filed = await fileAnswerBrief(brief, options.slug);
  printLine(`${filed.existed ? "updated" : "created"} ${filed.relativePath}`);
  printLine(renderAnswerBrief(brief, { verbose: options.verbose }));
}

export async function fileResearch(args: string[]) {
  const topic = args[0];
  if (!topic) throw new Error("missing topic");
  const routing = readResearchProjectRouting(args.slice(1));
  const titleParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (isResearchRoutingFlag(arg)) {
      if (arg === "--project") index += 1;
      continue;
    }
    titleParts.push(arg);
  }
  const title = titleParts.join(" ").trim();
  if (!title) throw new Error("missing title");
  if (routing.project) await assertProjectExists(routing.project);
  else if (routing.global) await assertGlobalResearchAllowed(topic, routing.global);
  else throw new Error("research file needs --project <project> for project-bound research, or --global for reusable cross-project research");
  const { outputPath } = await createResearchPage(topic, title, routing.project);
  appendLogEntry("file-research", title, { ...(routing.project ? { project: routing.project } : {}), details: [`topic=${topic}`, `path=${relative(VAULT_ROOT, outputPath)}`] });
  printLine(`created ${relative(VAULT_ROOT, outputPath)}`);
}
