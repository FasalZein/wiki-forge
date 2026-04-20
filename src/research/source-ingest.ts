import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, requireValue, today, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { copyFile, exists } from "../lib/fs";
import {
  canonicalizeResearchTopicForWrite,
  deriveSourceSlug,
  deriveSourceTitle,
  detectResearchSourceType,
  inferRawBucket,
  isAllowedRawBucket,
  rawBucketDir,
  rawPathForSource,
  rawVaultPath,
  researchPagePath,
  topicCrossLinks,
} from "../lib/research";
import { ensureResearchTopic } from "./_shared";

export async function ingestSource(args: string[]) {
  const { sources, topic, title, bucket } = parseIngestSourceArgs(args);
  const normalizedTopic = canonicalizeResearchTopicForWrite(topic ?? "sources/inbox");
  await ensureResearchTopic(normalizedTopic);
  for (const source of sources) {
    const resolvedBucket = bucket ?? inferRawBucket(source);
    const rawDir = rawBucketDir(resolvedBucket);
    const rawPath = rawPathForSource(source, resolvedBucket);
    const outputPath = researchPagePath(normalizedTopic, deriveSourceSlug(source));
    if (await exists(outputPath)) throw new Error(`research page already exists: ${relative(VAULT_ROOT, outputPath)}`);
    await mkdirIfMissing(rawDir);
    if (await exists(rawPath)) throw new Error(`raw source already exists: ${relative(VAULT_ROOT, rawPath)}`);

    if (/^https?:\/\//iu.test(source)) {
      const rawTitle = title ?? deriveSourceTitle(source);
      const rawData = orderFrontmatter({
        title: rawTitle,
        type: "raw-source",
        source_url: source,
        bucket: resolvedBucket,
        created_at: nowIso(),
        captured: today(),
        immutable: true,
      }, ["title", "type", "source_url", "bucket", "created_at", "captured", "immutable"]);
      const rawBody = [
        `# ${rawTitle}`,
        "",
        "> [!info]",
        "> Raw-source pointer note. The canonical content remains external.",
        "",
        "## Source",
        "",
        `- URL: ${source}`,
        "- Capture note: URL pointer only. Original content remains external.",
        "",
      ].join("\n");
      writeNormalizedPage(rawPath, rawBody, rawData);
    } else {
      if (!await exists(source)) throw new Error(`source path not found: ${source}`);
      await copyFile(source, rawPath);
    }

    const sourceLabel = /^https?:\/\//iu.test(source) ? source : relative(process.cwd(), source);
    const rawLink = `[[${rawVaultPath(rawPath)}]]`;
    const sourceType = await detectResearchSourceType(source);
    const data = orderFrontmatter({
      title: title ?? deriveSourceTitle(source),
      type: "research",
      topic: normalizedTopic,
      status: "draft",
      source_type: sourceType,
      sources: [{ raw: rawVaultPath(rawPath), accessed: today(), claim: "TODO: capture the specific claim supported by this source." }],
      influenced_by: [],
      created_at: nowIso(),
      updated: nowIso(),
      verification_level: "unverified",
    }, ["title", "type", "topic", "project", "status", "source_type", "sources", "influenced_by", "created_at", "updated", "verification_level"]);
    const body = [
      `# ${data.title}`,
      "",
      "> [!summary]",
      "> Source-backed research note linked to a raw artifact. Keep claims grounded in the raw note and promote only verified findings.",
      "",
      "## Source Summary",
      "",
      `- Source input: ${sourceLabel}`,
      `- Raw note: ${rawLink}`,
      "",
      "## TL;DR",
      "",
      "",
      "",
      "## Key Findings",
      "",
      `-  [1] ${rawLink}`,
      "",
      "## Claims To Verify",
      "",
      `-  ${rawLink}`,
      "",
      "## Sources",
      "",
      `1. ${rawLink}`,
      "",
      "## Cross Links",
      "",
      ...topicCrossLinks(normalizedTopic),
      "",
    ].join("\n");
    writeNormalizedPage(outputPath, body, data);
    appendLogEntry("ingest-source", data.title as string, { details: [`topic=${normalizedTopic}`, `raw=${relative(VAULT_ROOT, rawPath)}`, `path=${relative(VAULT_ROOT, outputPath)}`] });
    console.log(`created ${relative(VAULT_ROOT, rawPath)}`);
    console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
  }
}

function parseIngestSourceArgs(args: string[]) {
  const sources: string[] = [];
  let topic: string | undefined;
  let title: string | undefined;
  let bucket: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--topic") {
      topic = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--title") {
      title = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--bucket") {
      bucket = args[index + 1];
      index += 1;
      continue;
    }
    sources.push(arg);
  }
  if (!sources.length) throw new Error("missing source");
  if (topic !== undefined) requireValue(topic, "topic");
  if (title !== undefined) requireValue(title, "title");
  if (bucket !== undefined) requireValue(bucket, "bucket");
  if (bucket && !isAllowedRawBucket(bucket)) throw new Error(`unknown raw bucket: ${bucket}`);
  if (title && sources.length > 1) throw new Error("--title only supports a single source");
  return { sources, topic, title, bucket };
}
