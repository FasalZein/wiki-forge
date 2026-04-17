import { relative } from "node:path";
import { STALE_UNVERIFIED_DAYS, VAULT_ROOT } from "../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import {
  classifyRawPath,
  classifyResearchPath,
  describeAllowedRawPaths,
  describeAllowedResearchPaths,
  normalizeTopicPath,
  rawRoot,
  researchOverviewPath,
  researchRoot,
  researchTopicDir,
  topicCrossLinks,
  topicLabel,
} from "../lib/research";
import { normalizePath, stripMarkdownExtension, walkMarkdown } from "../lib/vault";

export const RESEARCH_STATUSES = ["draft", "reviewed", "verified", "applied"] as const;
export const RESEARCH_VERIFICATION_LEVELS = ["unverified", "cross-referenced", "source-checked"] as const;

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
