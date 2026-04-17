import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { requireValue } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { normalizeTopicPath } from "../lib/research";
import { ensureResearchTopic } from "./_shared";

export async function scaffoldResearch(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  requireValue(topic, "topic");
  const { overviewPath, created } = await ensureResearchTopic(topic);
  appendLogEntry("scaffold-research", normalizeTopicPath(topic), { details: [`path=${relative(VAULT_ROOT, overviewPath)}`] });
  console.log(`${created ? "created" : "exists"} ${relative(VAULT_ROOT, overviewPath)}`);
}
