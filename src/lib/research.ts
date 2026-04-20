import { basename, extname, join } from "node:path";
import { VAULT_ROOT } from "../constants";
import { exists } from "./fs";

const TOPIC_SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const TOPIC_PATH = `(?:${TOPIC_SEGMENT}\/)*${TOPIC_SEGMENT}`;
const TOPIC_PATH_PATTERN = new RegExp(`^${TOPIC_PATH}$`, "u");

export const RAW_BUCKETS = ["articles", "papers", "assets", "conversations"] as const;

export function slugifySegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "topic";
}

export function normalizeTopicPath(topic: string) {
  return topic
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => slugifySegment(segment))
    .join("/");
}

export function isCanonicalResearchTopic(topic: string) {
  return TOPIC_PATH_PATTERN.test(normalizeTopicPath(topic));
}

export function classifyResearchPath(relPath: string): "topic-overview" | "research-page" | null {
  const rel = relPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (new RegExp(`^research\/${TOPIC_PATH}\/_overview\.md$`, "u").test(rel)) return "topic-overview";
  if (new RegExp(`^research\/${TOPIC_PATH}\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$`, "u").test(rel)) return "research-page";
  return null;
}

export function isAllowedResearchPath(relPath: string) {
  return classifyResearchPath(relPath) !== null;
}

export function describeAllowedResearchPaths() {
  return "research/<topic>/_overview.md; research/<topic>/<slug>.md";
}

export function researchRoot() {
  return join(VAULT_ROOT, "research");
}

export function researchTopicDir(topic: string) {
  const normalized = normalizeTopicPath(topic);
  return join(researchRoot(), ...normalized.split("/"));
}

export function researchOverviewPath(topic: string) {
  return join(researchTopicDir(topic), "_overview.md");
}

export function researchPagePath(topic: string, slug: string) {
  return join(researchTopicDir(topic), `${slug}.md`);
}

export function topicLabel(topic: string) {
  const normalized = normalizeTopicPath(topic);
  const last = normalized.split("/").filter(Boolean).pop() ?? normalized;
  return last.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Research Topic";
}

export function topicCrossLinks(topic: string) {
  const normalized = normalizeTopicPath(topic);
  return [`- [[research/${normalized}/_overview]]`];
}

export function legacyProjectResearchTopic(project: string) {
  return normalizeTopicPath(`projects/${project}`);
}

export function slugifyResearchPage(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "research";
}

export function deriveSourceSlug(source: string) {
  if (/^https?:\/\//iu.test(source)) {
    return slugifyResearchPage(source.replace(/^https?:\/\//iu, "").replace(/[?#].*$/u, "").replace(/\/+$/u, ""));
  }
  const file = basename(source);
  return slugifyResearchPage(file.replace(new RegExp(`${escapeRegExp(extname(file))}$`), ""));
}

export function deriveSourceTitle(source: string) {
  if (/^https?:\/\//iu.test(source)) {
    return source.replace(/^https?:\/\//iu, "").replace(/[?#].*$/u, "");
  }
  const file = basename(source, extname(source));
  return file.split(/[-_ ]+/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Research Source";
}

export async function detectResearchSourceType(source: string): Promise<"web" | "paper" | "code" | "conversation" | "synthesis"> {
  const normalized = source.toLowerCase();
  if (/^https?:\/\//iu.test(source)) {
    if (normalized.includes("arxiv.org") || normalized.endsWith(".pdf")) return "paper";
    return "web";
  }
  const extension = extname(normalized);
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".rb", ".sh"].includes(extension)) return "code";
  if ([".pdf"].includes(extension)) return "paper";
  if ([".md", ".txt", ".json"].includes(extension)) return "conversation";
  return (await exists(source)) ? "code" : "synthesis";
}

export function questionTokens(question: string) {
  return question.toLowerCase().split(/[^a-z0-9]+/g).map((token) => token.trim()).filter((token) => token.length >= 4);
}

export function rawRoot() {
  return join(VAULT_ROOT, "raw");
}

export function isAllowedRawBucket(bucket: string) {
  return (RAW_BUCKETS as readonly string[]).includes(bucket);
}

export function classifyRawPath(relPath: string): "raw-file" | null {
  const rel = relPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (new RegExp(`^raw\/(?:${RAW_BUCKETS.join("|")})\/[^/]+$`, "u").test(rel)) return "raw-file";
  return null;
}

export function isAllowedRawPath(relPath: string) {
  return classifyRawPath(relPath) !== null;
}

export function describeAllowedRawPaths() {
  return `raw/<bucket>/<file> where <bucket> is one of: ${RAW_BUCKETS.join(", ")}`;
}

export function inferRawBucket(source: string) {
  const normalized = source.toLowerCase();
  if (/^https?:\/\//iu.test(source)) {
    if (normalized.includes("arxiv.org") || normalized.endsWith(".pdf")) return "papers";
    return "articles";
  }
  const extension = extname(normalized);
  if ([".pdf"].includes(extension)) return "papers";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "assets";
  if ([".md", ".txt", ".json"].includes(extension)) return "conversations";
  return "articles";
}

export function rawBucketDir(bucket: string) {
  if (!isAllowedRawBucket(bucket)) throw new Error(`unknown raw bucket: ${bucket}`);
  return join(rawRoot(), bucket);
}

export function rawPathForSource(source: string, bucket?: string) {
  const resolvedBucket = bucket ?? inferRawBucket(source);
  const ext = /^https?:\/\//iu.test(source)
    ? ".md"
    : extname(source) || ".txt";
  return join(rawBucketDir(resolvedBucket), `${deriveSourceSlug(source)}${ext}`);
}

export function rawVaultPath(path: string) {
  const rel = path.slice(VAULT_ROOT.length + 1).replaceAll("\\", "/");
  return rel.endsWith(".md") ? rel.slice(0, -3) : rel;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
