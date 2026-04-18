import { buildLexicalSearchQuery, buildStructuredHybridQuery, type RetrievalMode, resolveRetrievalMode } from "../lib/qmd";
import { getQmdStore, sdkHybridAvailable, searchKnowledgeExpandedSdk, searchKnowledgeHybridSdk, searchKnowledgeLexicalSdk, searchKnowledgeStructuredSdk } from "../lib/qmd-sdk";
import { QMD_INDEX_PATH, VAULT_ROOT } from "../constants";

const KNOWLEDGE_COLLECTION = "knowledge";
const KNOWLEDGE_CONTEXTS = [
  { path: "/", text: "Knowledge vault: projects, wiki, research" },
  { path: "/projects", text: "Project-specific maintained docs under projects/<name>. Prefer these for repo questions." },
  { path: "/research", text: "Research notes and evidence. Prefer when the question asks why, compares options, or needs supporting sources." },
  { path: "/wiki", text: "Cross-project concepts, entities, and syntheses. Use for shared patterns, not project-specific implementation unless no project docs exist." },
] as const;

export async function searchVault(args: string[]) {
  const hybrid = args[0] === "--hybrid";
  if (hybrid) console.warn("warning: 'wiki search --hybrid' overlaps with 'wiki query'. Prefer 'wiki query' for hybrid retrieval.");
  const query = (hybrid ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }

  const mode = resolveSearchRetrievalMode({ hybrid, sdkHybridAvailable: await sdkHybridAvailable() });
  if (mode === "sdk-bm25") {
    const results = await searchKnowledgeLexicalSdk(query);
    console.log(renderQueryResults(results));
    return;
  }
  if (mode === "sdk-hybrid") {
    const results = await searchKnowledgeHybridSdk(query);
    console.log(renderQueryResults(results));
    return;
  }
  const results = await searchKnowledgeStructuredSdk(buildStructuredHybridQuery(query), { cacheKeyPrefix: "search:sdk-structured" });
  console.log(renderQueryResults(results));
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
    console.log(renderQueryResults(results));
    return;
  }
  if (mode === "bm25") {
    const results = await searchKnowledgeLexicalSdk(buildLexicalSearchQuery(query), { maxResults: 5, cacheKeyPrefix: "query:sdk-bm25" });
    console.log(renderQueryResults(results));
    return;
  }
  if (mode === "sdk-hybrid") {
    const results = await searchKnowledgeHybridSdk(query, { maxResults: 5, cacheKeyPrefix: "query:sdk-hybrid" });
    console.log(renderQueryResults(results));
    return;
  }
  const results = await searchKnowledgeStructuredSdk(buildStructuredHybridQuery(query), { maxResults: 5, cacheKeyPrefix: "query:sdk-structured" });
  console.log(renderQueryResults(results));
}

export async function qmdStatus() {
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  const status = await store.getStatus();
  const contexts = await store.listContexts();
  console.log("QMD Status");
  console.log("");
  console.log(`Index: ${QMD_INDEX_PATH}`);
  console.log(`Documents: ${status.totalDocuments}`);
  console.log(`Needs embedding: ${status.needsEmbedding}`);
  console.log(`Vector index: ${status.hasVectorIndex ? "yes" : "no"}`);
  console.log(`Collections: ${status.collections.length}`);
  for (const collection of status.collections) {
    console.log(`  ${collection.name} (${collection.path})`);
    console.log(`    Pattern: ${collection.pattern}`);
    console.log(`    Files: ${collection.documents}`);
    const collectionContexts = contexts.filter((context) => context.collection === collection.name);
    if (collectionContexts.length) {
      console.log(`    Contexts: ${collectionContexts.length}`);
      for (const context of collectionContexts) console.log(`      ${context.path || "/"}: ${context.context}`);
    }
  }
}

export async function qmdUpdate(args: string[] = []) {
  const full = args.includes("--full");
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH, forceNew: full });
  await ensureKnowledgeCollectionSdk(store);
  if (full) {
    await store.removeCollection(KNOWLEDGE_COLLECTION);
    await store.addCollection(KNOWLEDGE_COLLECTION, { path: VAULT_ROOT, pattern: "**/*.md" });
    await ensureKnowledgeCollectionSdk(store);
  }
  const result = await store.update({ collections: [KNOWLEDGE_COLLECTION] });
  console.log(`qmd-update: indexed=${result.indexed} updated=${result.updated} unchanged=${result.unchanged} removed=${result.removed} needsEmbedding=${result.needsEmbedding}${full ? " (full rebuild)" : ""}`);
}

export async function qmdEmbed() {
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  await ensureKnowledgeCollectionSdk(store);
  const result = await store.embed({ chunkStrategy: "auto" });
  console.log(JSON.stringify(result, null, 2));
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
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  await ensureKnowledgeCollectionSdk(store);
  await store.update({ collections: [KNOWLEDGE_COLLECTION] });
  await store.embed({ chunkStrategy: "auto" });
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

async function ensureKnowledgeCollectionSdk(store: Awaited<ReturnType<typeof getQmdStore>>) {
  const collections = await store.listCollections();
  if (!collections.some((collection) => collection.name === KNOWLEDGE_COLLECTION)) {
    await store.addCollection(KNOWLEDGE_COLLECTION, { path: VAULT_ROOT, pattern: "**/*.md" });
  }
  const contexts = await store.listContexts();
  for (const context of KNOWLEDGE_CONTEXTS) {
    const exists = contexts.some((entry) => entry.collection === KNOWLEDGE_COLLECTION && entry.path === context.path && entry.context === context.text);
    if (!exists) await store.addContext(KNOWLEDGE_COLLECTION, context.path, context.text);
  }
}
