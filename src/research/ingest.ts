import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, requireValue, today, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { exists } from "../lib/fs";
import {
  canonicalizeResearchTopicForWrite,
  deriveSourceSlug,
  deriveSourceTitle,
  detectResearchSourceType,
  researchPagePath,
  topicCrossLinks,
} from "../lib/research";
import { ensureResearchTopic } from "./_shared";

export async function ingestResearch(args: string[]) {
  const { topic, sources, title } = parseIngestResearchArgs(args);
  const normalizedTopic = canonicalizeResearchTopicForWrite(topic);
  await ensureResearchTopic(normalizedTopic);
  for (const source of sources) {
    const slug = deriveSourceSlug(source);
    const outputPath = researchPagePath(normalizedTopic, slug);
    if (await exists(outputPath)) throw new Error(`research page already exists: ${relative(VAULT_ROOT, outputPath)}`);
    const sourceType = await detectResearchSourceType(source);
    const sourceField = /^https?:\/\//iu.test(source) ? { url: source } : { path: source };
    const data = orderFrontmatter({
      title: title ?? deriveSourceTitle(source),
      type: "research",
      topic: normalizedTopic,
      status: "draft",
      source_type: sourceType,
      sources: [{ ...sourceField, accessed: today(), claim: "TODO: capture the specific claim supported by this source." }],
      influenced_by: [],
      created_at: nowIso(),
      updated: nowIso(),
      verification_level: "unverified",
    }, ["title", "type", "topic", "project", "status", "source_type", "sources", "influenced_by", "created_at", "updated", "verification_level"]);
    const body = [
      `# ${data.title}`,
      "",
      "> [!summary]",
      "> Source-backed research note. Capture the claim, what changed, and where it should influence the wiki.",
      "",
      "## Source Summary",
      "",
      `- Source: ${source}`,
      "- Why it matters: ",
      "",
      "## TL;DR",
      "",
      "",
      "",
      "## Key Findings",
      "",
      "- ",
      "",
      "## Claims To Verify",
      "",
      "- ",
      "",
      "## Sources",
      "",
      `[1] ${source}`,
      "",
      "## Cross Links",
      "",
      ...topicCrossLinks(normalizedTopic),
      "",
    ].join("\n");
    writeNormalizedPage(outputPath, body, data);
    appendLogEntry("ingest-research", data.title as string, { details: [`topic=${normalizedTopic}`, `path=${relative(VAULT_ROOT, outputPath)}`] });
    console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
  }
}

function parseIngestResearchArgs(args: string[]) {
  const topic = args[0];
  requireValue(topic, "topic");
  const sources: string[] = [];
  let title: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--title") {
      title = args[index + 1];
      index += 1;
      continue;
    }
    sources.push(arg);
  }
  if (title) requireValue(title, "title");
  if (!sources.length) throw new Error("missing source");
  if (title && sources.length > 1) throw new Error("--title only supports a single source");
  return { topic, sources, title };
}
