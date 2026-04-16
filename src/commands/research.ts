import { join, relative } from "node:path";
import { VAULT_ROOT, STALE_UNVERIFIED_DAYS } from "../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, requireValue, safeMatter, today, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry } from "../lib/log";
import { copyFile, exists, readText, writeText } from "../lib/fs";
import { classifyRawPath, classifyResearchPath, describeAllowedRawPaths, describeAllowedResearchPaths, deriveSourceSlug, deriveSourceTitle, detectResearchSourceType, inferRawBucket, isAllowedRawBucket, normalizeTopicPath, rawBucketDir, rawPathForSource, rawRoot, rawVaultPath, researchOverviewPath, researchPagePath, researchRoot, researchTopicDir, slugifyResearchPage, topicCrossLinks, topicLabel } from "../lib/research";
import { normalizePath, stripMarkdownExtension, walkMarkdown } from "../lib/vault";
import { collectResearchAudit } from "../lib/research-audit";

const RESEARCH_STATUSES = ["draft", "reviewed", "verified", "applied"] as const;
const RESEARCH_VERIFICATION_LEVELS = ["unverified", "cross-referenced", "source-checked"] as const;

export async function scaffoldResearch(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  requireValue(topic, "topic");
  const { overviewPath, created } = await ensureResearchTopic(topic);
  appendLogEntry("scaffold-research", normalizeTopicPath(topic), { details: [`path=${relative(VAULT_ROOT, overviewPath)}`] });
  console.log(`${created ? "created" : "exists"} ${relative(VAULT_ROOT, overviewPath)}`);
}

export async function researchStatus(args: string[]) {
  const topic = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const result = await collectResearchStatus(topic);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`research status${result.topic ? ` for ${result.topic}` : ""}:`);
    console.log(`- root: ${result.root}`);
    console.log(`- pages: ${result.counts.total}`);
    console.log(`- missing sources: ${result.counts.missingSources}`);
    console.log(`- stale unverified: ${result.counts.staleUnverified}`);
    console.log(`- status: ${RESEARCH_STATUSES.map((status) => `${status}=${result.byStatus[status] ?? 0}`).join(" ")}`);
    console.log(`- verification: ${RESEARCH_VERIFICATION_LEVELS.map((level) => `${level}=${result.byVerification[level] ?? 0}`).join(" ")}`);
  }
}

export async function ingestResearch(args: string[]) {
  const { topic, sources, title } = parseIngestResearchArgs(args);
  const normalizedTopic = normalizeTopicPath(topic);
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

export async function ingestSource(args: string[]) {
  const { sources, topic, title, bucket } = parseIngestSourceArgs(args);
  const normalizedTopic = normalizeTopicPath(topic ?? "sources/inbox");
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

export async function ensureResearchTopic(topic: string) {
  const normalizedTopic = normalizeTopicPath(topic);
  const dir = researchTopicDir(normalizedTopic);
  await mkdirIfMissing(researchRoot());
  await mkdirIfMissing(dir);
  const overviewPath = researchOverviewPath(normalizedTopic);
  let created = false;
  if (!await exists(overviewPath)) {
    const data = orderFrontmatter({
      title: topicLabel(normalizedTopic),
      type: "research-topic",
      topic: normalizedTopic,
      created_at: nowIso(),
      updated: nowIso(),
      status: "current",
      verification_level: "unverified",
    }, ["title", "type", "topic", "created_at", "updated", "status", "verification_level"]);
    const body = [
      `# ${topicLabel(normalizedTopic)}`,
      "",
      "> [!summary]",
      "> Research topic hub. Link source-backed notes here and keep open questions visible.",
      "",
      "## Overview",
      "",
      "",
      "",
      "## Active Questions",
      "",
      "- ",
      "",
      "## Pages",
      "",
      "- ",
      "",
      "## Cross Links",
      "",
      ...topicCrossLinks(normalizedTopic).filter((line) => !line.includes("_overview")),
      "",
    ].join("\n");
    writeNormalizedPage(overviewPath, body, data);
    created = true;
  }
  return { topic: normalizedTopic, dir, overviewPath, created };
}

export async function collectResearchStatus(topic?: string) {
  const normalizedTopic = topic ? normalizeTopicPath(topic) : undefined;
  const root = normalizedTopic ? researchTopicDir(normalizedTopic) : researchRoot();
  const pages = (await walkMarkdown(root)).filter((file) => !file.endsWith("/_overview.md"));
  const byStatus = Object.fromEntries(RESEARCH_STATUSES.map((status) => [status, 0])) as Record<string, number>;
  const byVerification = Object.fromEntries(RESEARCH_VERIFICATION_LEVELS.map((level) => [level, 0])) as Record<string, number>;
  let missingSources = 0;
  let staleUnverified = 0;
  for (const file of pages) {
    const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
    if (!parsed) continue;
    const status = typeof parsed.data.status === "string" ? parsed.data.status : "draft";
    const verification = typeof parsed.data.verification_level === "string" ? parsed.data.verification_level : "unverified";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byVerification[verification] = (byVerification[verification] ?? 0) + 1;
    if (!Array.isArray(parsed.data.sources) || parsed.data.sources.length === 0) missingSources += 1;
    if (verification === "unverified" && isOlderThan(parsed.data.updated, STALE_UNVERIFIED_DAYS)) staleUnverified += 1;
  }
  return {
    topic: normalizedTopic,
    root: relative(VAULT_ROOT, root) || "research",
    counts: { total: pages.length, missingSources, staleUnverified },
    byStatus,
    byVerification,
  };
}

export async function collectResearchLintResult(topic?: string) {
  const normalizedTopic = topic ? normalizeTopicPath(topic) : undefined;
  const root = normalizedTopic ? researchTopicDir(normalizedTopic) : researchRoot();
  const pages = (await walkMarkdown(root)).sort();
  const issues: string[] = [];
  const inbound = await buildResearchInboundCounts();
  for (const file of pages) {
    const rel = normalizePath(relative(VAULT_ROOT, file));
    const relNoExt = stripMarkdownExtension(rel);
    const raw = await readText(file);
    const parsed = safeMatter(rel, raw, { silent: true });
    if (!parsed) {
      issues.push(`${rel} invalid frontmatter`);
      continue;
    }
    if (!classifyResearchPath(rel)) issues.push(`${rel} invalid research path: expected ${describeAllowedResearchPaths()}`);
    if (file.endsWith("/_overview.md")) continue;
    if (!Array.isArray(parsed.data.sources) || parsed.data.sources.length === 0) issues.push(`${rel} missing sources in frontmatter`);
    else if ((parsed.data.sources as unknown[]).some((entry) => !entry || typeof entry !== "object" || !("claim" in (entry as Record<string, unknown>)))) issues.push(`${rel} source entries should include claim attribution`);
    if ((parsed.data.verification_level ?? "unverified") === "unverified" && isOlderThan(parsed.data.updated, STALE_UNVERIFIED_DAYS)) issues.push(`${rel} stale unverified research page`);
    if (hasUnattributedClaims(parsed.content)) issues.push(`${rel} key findings lack inline attribution`);
    if ((inbound.get(relNoExt) ?? 0) === 0) issues.push(`${rel} not linked from any project or idea page`);
  }
  const rawRootPath = rawRoot();
  if (await exists(rawRootPath)) {
    for (const file of new Bun.Glob("**/*").scanSync({ cwd: rawRootPath, onlyFiles: true })) {
      const rel = normalizePath(`raw/${file}`);
      if (!classifyRawPath(rel)) issues.push(`${rel} invalid raw path: expected ${describeAllowedRawPaths()}`);
    }
  }
  return { topic: normalizedTopic, root: relative(VAULT_ROOT, root) || "research", issues };
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

async function buildResearchInboundCounts() {
  const counts = new Map<string, number>();
  for (const file of await walkMarkdown(VAULT_ROOT)) {
    const rel = normalizePath(relative(VAULT_ROOT, file));
    if (!rel.startsWith("projects/") && !rel.startsWith("ideas/")) continue;
    const body = await readText(file);
    for (const link of extractWikilinks(body)) {
      const target = stripMarkdownExtension(link);
      if (!target.startsWith("research/")) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

function extractWikilinks(body: string) {
  return [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => String(match[1]).trim()).filter(Boolean);
}

function isOlderThan(value: unknown, days: number) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageMs = Date.now() - parsed.getTime();
  return ageMs > days * 24 * 60 * 60 * 1000;
}

function hasUnattributedClaims(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let inKeyFindings = false;
  for (const line of lines) {
    if (line.startsWith("## ")) inKeyFindings = line.trim() === "## Key Findings";
    if (!inKeyFindings) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const text = trimmed.slice(2).trim();
    if (!text || text === "") continue;
    if (text.includes("[1]") || text.includes("source:") || text.includes("[[raw/")) continue;
    return true;
  }
  return false;
}

export async function createResearchPage(project: string, title: string, topic?: string) {
  const normalizedTopic = normalizeTopicPath(topic ?? `projects/${project}`);
  await ensureResearchTopic(normalizedTopic);
  const slug = slugifyResearchPage(title);
  const outputPath = researchPagePath(normalizedTopic, slug);
  if (await exists(outputPath)) throw new Error(`research page already exists: ${relative(VAULT_ROOT, outputPath)}`);
  const data = orderFrontmatter({
    title,
    type: "research",
    topic: normalizedTopic,
    project,
    status: "draft",
    source_type: "synthesis",
    sources: [],
    influenced_by: [],
    created_at: nowIso(),
    updated: nowIso(),
    verification_level: "unverified",
  }, ["title", "type", "topic", "project", "status", "source_type", "sources", "influenced_by", "created_at", "updated", "verification_level"]);
  const body = [
    `# ${title}`,
    "",
    "> [!summary]",
    "> Research synthesis note. Capture conclusions here, then link the evidence that supports them.",
    "",
    "## TL;DR",
    "",
    "",
    "",
    "## Key Findings",
    "",
    "- ",
    "",
    "## Landscape / Comparison",
    "",
    "",
    "",
    "## Open Questions",
    "",
    "- ",
    "",
    "## Sources",
    "",
    "[1] ",
    "",
    "## Cross Links",
    "",
    ...topicCrossLinks(normalizedTopic),
    "",
  ].join("\n");
  writeNormalizedPage(outputPath, body, data);
  return { topic: normalizedTopic, outputPath };
}
