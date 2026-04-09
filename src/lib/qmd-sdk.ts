import { createStore, type QMDStore, type SearchResult } from "@tobilu/qmd";
import { QMD_INDEX_PATH } from "../constants";
import type { QmdResult } from "../types";
import { fileFingerprint, readCache, writeCache } from "./cache";

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
  const normalized = results.map((result) => toQmdResult(query, result));
  await writeCache("qmd-sdk-json", cacheKey, QMD_SDK_CACHE_VERSION, fingerprint, { results: normalized });
  return normalized;
}

async function getStore() {
  if (!storePromise) {
    storePromise = createStore({ dbPath: QMD_INDEX_PATH });
  }
  return storePromise;
}

function toQmdResult(query: string, result: SearchResult): QmdResult {
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
