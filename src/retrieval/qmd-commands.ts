import { buildLexicalSearchQuery, buildStructuredHybridQuery, type RetrievalMode, resolveRetrievalMode } from "../lib/qmd";
import { getQmdStore, sdkHybridAvailable, searchKnowledgeExpandedSdk, searchKnowledgeHybridSdk, searchKnowledgeLexicalSdk, searchKnowledgeStructuredSdk } from "../lib/qmd-sdk";
import { QMD_INDEX_PATH } from "../constants";
import { embedKnowledgeIndex, refreshKnowledgeIndex } from "./qmd-freshness";
import { printError, printJson, printLine } from "../lib/cli-output";

export async function searchVault(args: string[]) {
  const hybrid = args[0] === "--hybrid";
  if (hybrid) printError("warning: 'wiki search --hybrid' overlaps with 'wiki query'. Prefer 'wiki query' for hybrid retrieval.");
  const query = (hybrid ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }

  const mode = resolveSearchRetrievalMode({ hybrid, sdkHybridAvailable: await sdkHybridAvailable() });
  if (mode === "sdk-bm25") {
    const results = await searchKnowledgeLexicalSdk(query);
    printLine(renderQueryResults(results));
    return;
  }
  if (mode === "sdk-hybrid") {
    const results = await searchKnowledgeHybridSdk(query);
    printLine(renderQueryResults(results));
    return;
  }
  const results = await searchKnowledgeStructuredSdk(buildStructuredHybridQuery(query), { cacheKeyPrefix: "search:sdk-structured" });
  printLine(renderQueryResults(results));
}

export async function queryVault(args: string[]) {
  const expand = args.includes("--expand");
  const useBm25 = args.includes("--bm25");
  const query = args.filter((a) => a !== "--expand" && a !== "--bm25").join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }
  process.stderr.write("note: 'wiki query' returns raw hits across the vault. For a project-scoped answer brief with sources, use 'wiki ask <project> <question>'.\n");

  const mode = resolveRetrievalMode(query, { expand, bm25: useBm25, sdkHybridAvailable: await sdkHybridAvailable() });
  if (mode === "expand") {
    const results = await searchKnowledgeExpandedSdk(query, { maxResults: 5, cacheKeyPrefix: "query:sdk-expand" });
    printLine(renderQueryResults(results));
    return;
  }
  if (mode === "bm25") {
    const results = await searchKnowledgeLexicalSdk(buildLexicalSearchQuery(query), { maxResults: 5, cacheKeyPrefix: "query:sdk-bm25" });
    printLine(renderQueryResults(results));
    return;
  }
  if (mode === "sdk-hybrid") {
    const results = await searchKnowledgeHybridSdk(query, { maxResults: 5, cacheKeyPrefix: "query:sdk-hybrid" });
    printLine(renderQueryResults(results));
    return;
  }
  const results = await searchKnowledgeStructuredSdk(buildStructuredHybridQuery(query), { maxResults: 5, cacheKeyPrefix: "query:sdk-structured" });
  printLine(renderQueryResults(results));
}

export async function qmdStatus() {
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  const status = await store.getStatus();
  const contexts = await store.listContexts();
  printLine("QMD Status");
  printLine("");
  printLine(`Index: ${QMD_INDEX_PATH}`);
  printLine(`Documents: ${status.totalDocuments}`);
  printLine(`Needs embedding: ${status.needsEmbedding}`);
  printLine(`Vector index: ${status.hasVectorIndex ? "yes" : "no"}`);
  printLine(`Collections: ${status.collections.length}`);
  for (const collection of status.collections) {
    printLine(`  ${collection.name} (${collection.path})`);
    printLine(`    Pattern: ${collection.pattern}`);
    printLine(`    Files: ${collection.documents}`);
    const collectionContexts = contexts.filter((context) => context.collection === collection.name);
    if (collectionContexts.length) {
      printLine(`    Contexts: ${collectionContexts.length}`);
      for (const context of collectionContexts) printLine(`      ${context.path || "/"}: ${context.context}`);
    }
  }
}

export async function qmdUpdate(args: string[] = []) {
  const full = args.includes("--full");
  const { update } = await refreshKnowledgeIndex({ full });
  printLine(`qmd-update: indexed=${update.indexed} updated=${update.updated} unchanged=${update.unchanged} removed=${update.removed} needsEmbedding=${update.needsEmbedding}${full ? " (full rebuild)" : ""}`);
}

export async function qmdEmbed() {
  const result = await embedKnowledgeIndex();
  printJson(result);
}

function renderQueryResults(results: Array<{ file: string; title: string; context?: string; score: number; snippet: string; docid: string }>) {
  return results.map((result) => [
    `${result.file}:${result.docid}`,
    `Title: ${result.title}`,
    ...(result.context ? [`Context: ${result.context}`] : []),
    `Score:  ${Math.round(result.score * 100)}%`,
    "",
    result.snippet,
  ].join("\n")).join("\n\n");
}

export async function qmdSetup() {
  await refreshKnowledgeIndex();
  await embedKnowledgeIndex();
}

export function resolveSearchRetrievalMode(options: { hybrid?: boolean; sdkHybridAvailable?: boolean }) {
  if (!options.hybrid) return "sdk-bm25" as const;
  return options.sdkHybridAvailable ? "sdk-hybrid" as const : "structured-hybrid" as const;
}

export function resolveQueryExecutionMode(mode: RetrievalMode) {
  if (mode === "expand") return "sdk-expand" as const;
  if (mode === "bm25") return "sdk-bm25" as const;
  if (mode === "sdk-hybrid") return "sdk-hybrid" as const;
  return "sdk-structured" as const;
}
