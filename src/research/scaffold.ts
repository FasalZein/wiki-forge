import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { requireValue } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { canonicalizeResearchTopicForWrite } from "../lib/research";
import { ensureResearchTopic } from "./_shared";
import { printLine } from "../lib/cli-output";

export async function scaffoldResearch(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  requireValue(topic, "topic");
  const normalizedTopic = canonicalizeResearchTopicForWrite(topic);
  const { overviewPath, created } = await ensureResearchTopic(normalizedTopic);
  appendLogEntry("scaffold-research", normalizedTopic, { details: [`path=${relative(VAULT_ROOT, overviewPath)}`] });
  printLine(`${created ? "created" : "exists"} ${relative(VAULT_ROOT, overviewPath)}`);
}
