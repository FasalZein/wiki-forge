import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { projectRoot } from "../../cli-shared";
import { exists } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { createResearchPage } from "../research";
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
  let project: string | undefined;
  const titleParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") {
      project = args[index + 1];
      if (!project) throw new Error("missing project");
      index += 1;
      continue;
    }
    titleParts.push(arg);
  }
  const title = titleParts.join(" ").trim();
  if (!title) throw new Error("missing title");
  if (project) {
    const root = projectRoot(project);
    if (!await exists(root)) throw new Error(`project not found: ${project}`);
  }
  const { outputPath } = await createResearchPage(topic, title, project);
  appendLogEntry("file-research", title, { ...(project ? { project } : {}), details: [`topic=${topic}`, `path=${relative(VAULT_ROOT, outputPath)}`] });
  printLine(`created ${relative(VAULT_ROOT, outputPath)}`);
}
