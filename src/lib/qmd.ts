import { existsSync } from "node:fs";
import { QMD_INDEX_NAME, QMD_INDEX_PATH, QMD_NODE_CLI, VAULT_ROOT } from "../constants";
import type { QmdResult } from "../types";
import { fileFingerprint, readCache, writeCache } from "./cache";
import { resolveCommandOnPath } from "./runtime";

const QMD_CACHE_VERSION = "1";

type QmdCapture = {
  stdout: string;
  stderr: string;
};

export type RetrievalIntent = "location" | "rationale" | "general";

let qmdAvailable: boolean | null = null;

const DEFAULT_KNOWLEDGE_CONTEXTS = [
  { path: "qmd://knowledge", text: "Knowledge vault: projects, wiki, research" },
  { path: "/", text: "Use index.md first, then _summary.md, then drill deeper." },
  { path: "qmd://knowledge/projects", text: "Project-specific maintained docs under projects/<name>. Prefer these for repo questions." },
  { path: "qmd://knowledge/research", text: "Research notes and evidence. Prefer when the question asks why, compares options, or needs supporting sources." },
  { path: "qmd://knowledge/wiki", text: "Cross-project concepts, entities, and syntheses. Use for shared patterns, not project-specific implementation unless no project docs exist." },
] as const;

export async function runQmd(args: string[]) {
  const proc = Bun.spawn(qmdInvocation(args), {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`qmd ${args[0]} failed with exit code ${code}`);
  }
}

export async function runQmdCached(args: string[], cacheKey: string) {
  const cached = await readCache<QmdCapture>("qmd-output", cacheKey, QMD_CACHE_VERSION, qmdFingerprint());
  if (cached) {
    if (cached.stderr) process.stderr.write(cached.stderr);
    if (cached.stdout) process.stdout.write(cached.stdout);
    return;
  }

  const capture = await captureQmd(args);
  await writeCache("qmd-output", cacheKey, QMD_CACHE_VERSION, qmdFingerprint(), capture);
  if (capture.stderr) process.stderr.write(capture.stderr);
  if (capture.stdout) process.stdout.write(capture.stdout);
}

export async function captureQmd(args: string[]) {
  const proc = Bun.spawn(qmdInvocation(args), {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`qmd ${args[0]} failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`);
  }

  return { stdout, stderr };
}

export async function captureQmdJsonCached(args: string[], cacheKey: string) {
  const cached = await readCache<QmdCapture>("qmd-json", cacheKey, QMD_CACHE_VERSION, qmdFingerprint());
  if (cached) {
    return parseQmdJson(cached.stdout);
  }

  const capture = await captureQmd(args);
  await writeCache("qmd-json", cacheKey, QMD_CACHE_VERSION, qmdFingerprint(), capture);
  return parseQmdJson(capture.stdout);
}

export function normalizeSemanticQueryText(query: string) {
  return query
    .replace(/\r?\n+/g, " ")
    .replace(/(^|\s)-(?=(?:\p{L}|\p{N}|"))/gu, "$1")
    .replace(/(?<=\p{L}|\p{N})[-_/]+(?=\p{L}|\p{N})/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildStructuredHybridQuery(query: string, options?: { intent?: string }) {
  const lines: string[] = [];
  if (options?.intent) lines.push(`intent: ${options.intent}`);
  lines.push(`lex: ${query}`);
  lines.push(`vec: ${normalizeSemanticQueryText(query)}`);
  return lines.join("\n");
}

export type RetrievalMode = "bm25" | "sdk-hybrid" | "structured-hybrid" | "expand";

export function resolveRetrievalMode(query: string, options?: { expand?: boolean; sdkHybridAvailable?: boolean }): RetrievalMode {
  if (options?.expand) return "expand";
  if (classifyRetrievalIntent(query) !== "rationale") return "bm25";
  return options?.sdkHybridAvailable ? "sdk-hybrid" : "structured-hybrid";
}

export function classifyRetrievalIntent(query: string): RetrievalIntent {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (/(^|\b)(where|which|what)\b/u.test(normalized) && /(\b(file|files|doc|docs|page|pages|module|modules|spec|specs|prd|prds|slice|slices|task|tasks|folder|folders|route|routes)\b|\blive\b|\blocated\b|\bimplemented\b|\bdefined\b|\bstored\b|\bkept\b|\bowned\b)/u.test(normalized)) {
    return "location";
  }
  if (/(^|\b)(why|compare|comparison|tradeoff|tradeoffs|decision|decisions|rationale|history|landscape)\b/u.test(normalized)) {
    return "rationale";
  }
  return "general";
}

export function buildLexicalSearchQuery(query: string) {
  const normalizedQuestion = query.toLowerCase();
  const baseTerms = query
    .split(/[^a-z0-9-]+/iu)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^(where|which|what|does|do|how|live|lives|about|into|with|from|this|that|there)$/u.test(token.toLowerCase()));
  const hints: string[] = [];
  if (/\bprds?\b/u.test(normalizedQuestion)) hints.push("prd", "spec", "specs");
  if (/\b(slice|task)\b/u.test(normalizedQuestion)) hints.push("slice", "task", "specs", "plan", "test-plan");
  if (/\b(module|modules)\b/u.test(normalizedQuestion)) hints.push("module", "spec");
  if (/\b(file|files|doc|docs|page|pages)\b/u.test(normalizedQuestion)) hints.push("docs", "page", "spec");
  if (/\b(decision|decisions|forge)\b/u.test(normalizedQuestion)) hints.push("decisions", "forge");
  const terms = [...baseTerms, ...hints];
  const deduped = terms.filter((term, index) => terms.indexOf(term) === index);
  return deduped.join(" ").trim() || query;
}

function isRecoverableStructuredQueryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Negation (-term) is not supported in vec/hyde queries");
}

export async function searchKnowledge(query: string, options?: { hybrid?: boolean; writeOutput?: boolean }) {
  assertQmdAvailable();
  const hybrid = options?.hybrid ?? false;
  const args = hybrid
    ? ["query", buildStructuredHybridQuery(query), "-c", "knowledge"]
    : ["search", query, "-c", "knowledge"];
  const cacheKey = hybrid ? `search:hybrid:${query}` : `search:${query}`;
  try {
    if (options?.writeOutput === false) return captureQmd(args);
    await runQmdCached(args, cacheKey);
  } catch (error) {
    if (!hybrid || !isRecoverableStructuredQueryError(error)) throw error;
    const fallbackArgs = ["query", query, "-c", "knowledge"];
    const fallbackCacheKey = `${cacheKey}:expand-fallback`;
    if (options?.writeOutput === false) return captureQmd(fallbackArgs);
    await runQmdCached(fallbackArgs, fallbackCacheKey);
  }
}

export async function searchKnowledgeJson(query: string, options?: { hybrid?: boolean; maxResults?: number; cacheKeyPrefix?: string; }): Promise<QmdResult[]> {
  assertQmdAvailable();
  const hybrid = options?.hybrid ?? false;
  const args = hybrid
    ? ["query", buildStructuredHybridQuery(query), "-c", "knowledge", "--json"]
    : ["search", query, "-c", "knowledge", "--json"];
  if (typeof options?.maxResults === "number") args.push("-n", String(options.maxResults));
  const cachePrefix = options?.cacheKeyPrefix ?? (hybrid ? "search-json:hybrid" : "search-json");
  const cacheKey = `${cachePrefix}:${query}:${options?.maxResults ?? "default"}`;
  try {
    return await captureQmdJsonCached(args, cacheKey);
  } catch (error) {
    if (!hybrid || !isRecoverableStructuredQueryError(error)) throw error;
    const fallbackArgs = ["query", query, "-c", "knowledge", "--json"];
    if (typeof options?.maxResults === "number") fallbackArgs.push("-n", String(options.maxResults));
    return captureQmdJsonCached(fallbackArgs, `${cacheKey}:expand-fallback`);
  }
}

export async function queryKnowledge(query: string, options: { expand?: boolean; json: true; maxResults?: number; cacheKeyPrefix?: string; }): Promise<QmdResult[]>;
export async function queryKnowledge(query: string, options?: { expand?: boolean; json?: false; maxResults?: number; cacheKeyPrefix?: string; }): Promise<void>;
export async function queryKnowledge(query: string, options?: { expand?: boolean; json?: boolean; maxResults?: number; cacheKeyPrefix?: string; }): Promise<QmdResult[] | void> {
  assertQmdAvailable();
  const expand = options?.expand ?? false;
  const commandArgs = ["query", expand ? query : buildStructuredHybridQuery(query), "-c", "knowledge"];
  if (options?.json) commandArgs.push("--json");
  if (typeof options?.maxResults === "number") commandArgs.push("-n", String(options.maxResults));
  const cachePrefix = options?.cacheKeyPrefix ?? "query";
  const cacheKey = `${cachePrefix}:${expand ? "expand" : "structured"}:${query}:${options?.maxResults ?? "default"}:${options?.json ? "json" : "text"}`;
  try {
    if (options?.json) return await captureQmdJsonCached(commandArgs, cacheKey);
    await runQmdCached(commandArgs, cacheKey);
    return;
  } catch (error) {
    if (expand || !isRecoverableStructuredQueryError(error)) throw error;
    const fallbackArgs = ["query", query, "-c", "knowledge"];
    if (options?.json) fallbackArgs.push("--json");
    if (typeof options?.maxResults === "number") fallbackArgs.push("-n", String(options.maxResults));
    const fallbackCacheKey = `${cacheKey}:expand-fallback`;
    if (options?.json) return captureQmdJsonCached(fallbackArgs, fallbackCacheKey);
    await runQmdCached(fallbackArgs, fallbackCacheKey);
  }
}

export async function ensureKnowledgeCollection() {
  assertQmdAvailable();
  const list = await captureQmd(["collection", "list"]);
  if (!list.stdout.includes("knowledge")) {
    await runQmd(["collection", "add", VAULT_ROOT, "--name", "knowledge", "--mask", "**/*.md"]);
  }

  const contexts = await captureQmd(["context", "list"]);
  for (const context of DEFAULT_KNOWLEDGE_CONTEXTS) {
    if (!contexts.stdout.includes(context.text)) {
      await runQmd(["context", "add", context.path, context.text]);
    }
  }
}

function qmdInvocation(args: string[]) {
  const indexArgs = QMD_INDEX_NAME === "index" ? [] : ["--index", QMD_INDEX_NAME];
  if (existsSync(QMD_NODE_CLI)) {
    return ["node", QMD_NODE_CLI, ...indexArgs, ...args];
  }
  return ["qmd", ...indexArgs, ...args];
}

export function assertQmdAvailable() {
  if (qmdAvailable === true) return;
  if (existsSync(QMD_NODE_CLI)) {
    qmdAvailable = true;
    return;
  }
  if (resolveCommandOnPath("qmd")) {
    qmdAvailable = true;
    return;
  }
  qmdAvailable = false;
  throw new Error(
    "qmd not found. Retrieval commands (search, query, ask) require qmd.\n" +
      "Install qmd, then run 'wiki qmd-setup'.\n" +
      "Or set QMD_NODE_CLI to your qmd.js path.",
  );
}

function qmdFingerprint() {
  return fileFingerprint(QMD_INDEX_PATH);
}

function parseQmdJson(stdout: string) {
  try {
    return JSON.parse(stdout) as QmdResult[];
  } catch (error) {
    throw new Error(`unable to parse qmd JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}
