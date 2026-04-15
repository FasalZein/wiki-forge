import { exists } from "./fs";
import type { ExpandedQuery, HybridQueryResult, QMDStore, SearchResult, StoreOptions } from "@tobilu/qmd";
import { QMD_INDEX_PATH } from "../constants";
import { normalizeSemanticQueryText } from "./qmd";
import type { QmdResult } from "../types";
import { fileFingerprint, readCache, writeCache } from "./cache";
import { fromQmdFile } from "./vault";

const HOMEBREW_SQLITE_PATHS = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",    // Intel
];
const QMD_SDK_CACHE_VERSION = "2";

let storePromise: Promise<QMDStore> | null = null;

type CachedSdkResults = {
  results: QmdResult[];
};

export async function searchKnowledgeLexicalSdk(query: string, options?: { maxResults?: number; cacheKeyPrefix?: string; }) {
  const cachePrefix = options?.cacheKeyPrefix ?? "sdk-search";
  const cacheKey = `${cachePrefix}:${query}:${options?.maxResults ?? "default"}`;
  const fingerprint = fileFingerprint(QMD_INDEX_PATH);
  const cached = await readCache<CachedSdkResults>("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint);
  if (cached) return cached.results;

  const store = await getStore();
  const results = await store.searchLex(query, {
    limit: options?.maxResults ?? 10,
    collection: "knowledge",
  });
  const normalized = results.map((result) => lexResultToQmdResult(query, result));
  await writeCache("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint, { results: normalized });
  return normalized;
}

export async function searchKnowledgeHybridSdk(query: string, options?: { intent?: string; maxResults?: number; cacheKeyPrefix?: string; }) {
  const cachePrefix = options?.cacheKeyPrefix ?? "sdk-hybrid";
  const cacheKey = `${cachePrefix}:${query}:${options?.maxResults ?? "default"}`;
  const fingerprint = fileFingerprint(QMD_INDEX_PATH);
  const cached = await readCache<CachedSdkResults>("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint);
  if (cached) return cached.results;

  const store = await getStore();
  const queries = buildPreExpandedQueries(query);
  const results = await store.search({
    queries,
    rerank: false,
    collection: "knowledge",
    limit: options?.maxResults ?? 10,
  });
  const normalized = results.map((result) => hybridResultToQmdResult(query, result));
  await writeCache("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint, { results: normalized });
  return normalized;
}

export async function searchKnowledgeExpandedSdk(query: string, options?: { intent?: string; maxResults?: number; cacheKeyPrefix?: string; rerank?: boolean }) {
  const cachePrefix = options?.cacheKeyPrefix ?? "sdk-expanded";
  const cacheKey = `${cachePrefix}:${query}:${options?.maxResults ?? "default"}:${options?.intent ?? ""}:${options?.rerank ?? "default"}`;
  const fingerprint = fileFingerprint(QMD_INDEX_PATH);
  const cached = await readCache<CachedSdkResults>("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint);
  if (cached) return cached.results;

  const store = await getStore();
  const results = await store.search({
    query,
    intent: options?.intent,
    rerank: options?.rerank,
    collection: "knowledge",
    limit: options?.maxResults ?? 10,
  });
  const normalized = results.map((result) => hybridResultToQmdResult(query, result));
  await writeCache("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint, { results: normalized });
  return normalized;
}

export async function searchKnowledgeStructuredSdk(queryDocument: string, options?: { maxResults?: number; cacheKeyPrefix?: string; rerank?: boolean }) {
  const parsed = parseStructuredQueryDocument(queryDocument);
  const cachePrefix = options?.cacheKeyPrefix ?? "sdk-structured";
  const cacheKey = `${cachePrefix}:${queryDocument}:${options?.maxResults ?? "default"}:${options?.rerank ?? "default"}`;
  const fingerprint = fileFingerprint(QMD_INDEX_PATH);
  const cached = await readCache<CachedSdkResults>("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint);
  if (cached) return cached.results;

  const store = await getStore();
  const results = await store.search({
    queries: parsed.queries,
    intent: parsed.intent,
    rerank: options?.rerank,
    collection: "knowledge",
    limit: options?.maxResults ?? 10,
  });
  const normalized = results.map((result) => hybridResultToQmdResult(queryDocument, result));
  await writeCache("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint, { results: normalized });
  return normalized;
}

function buildPreExpandedQueries(query: string): ExpandedQuery[] {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  return [
    { type: "lex" as const, query: cleanQuery },
    { type: "vec" as const, query: normalizeSemanticQueryText(cleanQuery) },
  ];
}

function parseStructuredQueryDocument(queryDocument: string): { intent?: string; queries: ExpandedQuery[] } {
  let intent: string | undefined;
  const queries: ExpandedQuery[] = [];

  for (const rawLine of queryDocument.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("intent:")) {
      const value = line.slice("intent:".length).trim();
      if (value) intent = value;
      continue;
    }
    const match = line.match(/^(lex|vec|hyde):\s*(.+)$/u);
    if (!match) continue;
    queries.push({
      type: match[1] as ExpandedQuery["type"],
      query: match[2].trim(),
    });
  }

  if (!queries.length) {
    throw new Error("structured sdk query requires at least one lex/vec/hyde line");
  }

  return { intent, queries };
}

export async function sdkHybridAvailable() {
  return Promise.all(HOMEBREW_SQLITE_PATHS.map((p) => exists(p))).then((r) => r.some(Boolean));
}

export async function getQmdStore(options?: StoreOptions & { forceNew?: boolean }): Promise<QMDStore> {
  // qmd@0.x handles Database.setCustomSQLite() internally in its db module.
  if (options?.forceNew) {
    const mod = await import("@tobilu/qmd");
    return mod.createStore({ dbPath: options.dbPath, config: options.config, configPath: options.configPath });
  }
  if (!storePromise) {
    storePromise = import("@tobilu/qmd").then((mod) => mod.createStore({ dbPath: QMD_INDEX_PATH }));
  }
  return storePromise;
}

async function getStore(): Promise<QMDStore> {
  return getQmdStore({ dbPath: QMD_INDEX_PATH });
}

function lexResultToQmdResult(query: string, result: SearchResult): QmdResult {
  const body = typeof result.body === "string" ? result.body : "";
  const snippet = body ? buildSnippet(body, query) : `@@ -1,1 @@\n${result.title}`;
  return {
    docid: `#${result.docid}`,
    score: result.score,
    file: fromQmdFile(result.filepath),
    title: result.title,
    context: result.context ?? undefined,
    snippet,
  };
}

function hybridResultToQmdResult(query: string, result: HybridQueryResult): QmdResult {
  const body = typeof result.body === "string" ? result.body : "";
  const snippet = body ? buildSnippet(body, query) : `@@ -1,1 @@\n${result.title}`;
  return {
    docid: `#${result.docid}`,
    score: result.score,
    file: fromQmdFile(result.file),
    title: result.title,
    context: result.context ?? undefined,
    snippet,
  };
}

function buildSnippet(body: string, query: string) {
  const lowered = query.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/u).filter((token) => token.length >= 3);
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const match = lines.find((line) => {
    const normalized = line.toLowerCase();
    return normalized.includes(lowered) || tokens.some((token) => normalized.includes(token));
  });
  const text = (match ?? lines.find((line) => line.trim()) ?? body).replace(/\s+/g, " ").trim();
  return `@@ -1,1 @@\n${text.slice(0, 220)}`;
}
