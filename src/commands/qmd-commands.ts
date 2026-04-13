import { assertQmdAvailable, buildLexicalSearchQuery, queryKnowledge, resolveRetrievalMode, searchKnowledge } from "../lib/qmd";
import { getQmdStore, sdkHybridAvailable, searchKnowledgeHybridSdk, searchKnowledgeLexicalSdk } from "../lib/qmd-sdk";
import { QMD_INDEX_PATH, VAULT_ROOT } from "../constants";

const KNOWLEDGE_COLLECTION = "knowledge";
const KNOWLEDGE_CONTEXTS = [
  { path: "/", text: "Knowledge vault: projects, wiki, research" },
  { path: "/projects", text: "Project-specific maintained docs under projects/<name>. Prefer these for repo questions." },
  { path: "/research", text: "Research notes and evidence. Prefer when the question asks why, compares options, or needs supporting sources." },
  { path: "/wiki", text: "Cross-project concepts, entities, and syntheses. Use for shared patterns, not project-specific implementation unless no project docs exist." },
] as const;

export async function searchVault(args: string[]) {
  assertQmdAvailable();
  const hybrid = args[0] === "--hybrid";
  if (hybrid) console.warn("warning: 'wiki search --hybrid' overlaps with 'wiki query'. Prefer 'wiki query' for hybrid retrieval.");
  const query = (hybrid ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }

  await searchKnowledge(query, { hybrid });
}

export async function queryVault(args: string[]) {
  assertQmdAvailable();
  const expand = args[0] === "--expand";
  const query = (expand ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }

  const mode = resolveRetrievalMode(query, { expand, sdkHybridAvailable: sdkHybridAvailable() });
  if (mode === "expand") {
    await queryKnowledge(query, { expand: true });
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
  await queryKnowledge(query, { expand: false });
}

export async function qmdStatus() {
  assertQmdAvailable();
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

export async function qmdUpdate() {
  assertQmdAvailable();
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  await ensureKnowledgeCollectionSdk(store);
  const result = await store.update({ collections: [KNOWLEDGE_COLLECTION] });
  console.log(JSON.stringify(result, null, 2));
}

export async function qmdEmbed() {
  assertQmdAvailable();
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
  assertQmdAvailable();
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  await ensureKnowledgeCollectionSdk(store);
  await store.update({ collections: [KNOWLEDGE_COLLECTION] });
  await store.embed({ chunkStrategy: "auto" });
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
