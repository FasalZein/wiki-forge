import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { requireValue } from "../../cli-shared";
import { appendLogEntry } from "../../lib/log";
import { canonicalizeResearchTopicForWrite } from "../../lib/research";
import { ensureProjectResearchTopic, ensureResearchTopic } from "./_shared";
import { assertGlobalResearchAllowed, assertProjectExists, isResearchRoutingFlag, readResearchProjectRouting } from "./project-routing";
import { printLine } from "../../lib/cli-output";

export async function scaffoldResearch(args: string[]) {
  const routing = readResearchProjectRouting(args);
  const topic = readTopic(args);
  requireValue(topic, "topic");
  const normalizedTopic = canonicalizeResearchTopicForWrite(topic);
  if (routing.project) await assertProjectExists(routing.project);
  else if (routing.global) await assertGlobalResearchAllowed(topic, routing.global);
  else throw new Error("research scaffold needs --project <project> for project-bound research, or --global for reusable cross-project research");
  const { overviewPath, created } = routing.project
    ? await ensureProjectResearchTopic(routing.project, normalizedTopic)
    : await ensureResearchTopic(normalizedTopic);
  appendLogEntry("scaffold-research", normalizedTopic, { ...(routing.project ? { project: routing.project } : {}), details: [`path=${relative(VAULT_ROOT, overviewPath)}`] });
  printLine(`${created ? "created" : "exists"} ${relative(VAULT_ROOT, overviewPath)}`);
}

function readTopic(args: readonly string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (isResearchRoutingFlag(arg)) {
      if (arg === "--project") index += 1;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
  }
  return undefined;
}
