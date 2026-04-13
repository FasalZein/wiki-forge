import { existsSync } from "node:fs";
import type { ExpandedQuery, HybridQueryResult, QMDStore, SearchResult, StoreOptions } from "@tobilu/qmd";
import { QMD_INDEX_PATH } from "../constants";
import { normalizeSemanticQueryText } from "./qmd";
import type { QmdResult } from "../types";
import { fileFingerprint, readCache, writeCache } from "./cache";

const HOMEBREW_SQLITE = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
const QMD_SDK_CACHE_VERSION = "2";

// Swap Apple's SQLite for Homebrew's before ANY Database instance is created.
// This enables sqlite-vec extension loading on macOS.
// Must happen before @tobilu/qmd is imported (it uses better-sqlite3 → bun:sqlite).
let sqliteSwapped = false;
function ensureCustomSqlite() {
  if (sqliteSwapped) return;
  sqliteSwapped = true;
  if (!existsSync(HOMEBREW_SQLITE)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite");
    Database.setCustomSQLite(HOMEBREW_SQLITE);
  } catch {
    // Already loaded or not in Bun — continue with default SQLite
  }
}

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

function buildPreExpandedQueries(query: string): ExpandedQuery[] {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  return [
    { type: "lex" as const, query: cleanQuery },
    { type: "vec" as const, query: normalizeSemanticQueryText(cleanQuery) },
  ];
}

export function sdkHybridAvailable() {
  return existsSync(HOMEBREW_SQLITE);
}

export async function getQmdStore(options?: StoreOptions & { forceNew?: boolean }): Promise<QMDStore> {
  ensureCustomSqlite();
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
    file: result.filepath,
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
    file: result.file,
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
