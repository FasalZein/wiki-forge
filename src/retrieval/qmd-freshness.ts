import { QMD_INDEX_PATH, VAULT_ROOT } from "../constants";
import { resolveRetrievalMode, type RetrievalMode } from "../lib/qmd";
import { getQmdStore } from "../lib/qmd-sdk";

export const KNOWLEDGE_COLLECTION = "knowledge";

export const KNOWLEDGE_CONTEXTS = [
  { path: "/", text: "Knowledge vault: projects, wiki, research" },
  { path: "/projects", text: "Project-specific maintained docs under projects/<name>. Prefer these for repo questions." },
  { path: "/research", text: "Research notes and evidence. Prefer when the question asks why, compares options, or needs supporting sources." },
  { path: "/wiki", text: "Cross-project concepts, entities, and syntheses. Use for shared patterns, not project-specific implementation unless no project docs exist." },
] as const;

type KnowledgeIndexStatus = {
  needsEmbedding: number;
  hasVectorIndex: boolean;
};

export async function refreshKnowledgeIndex(options?: { full?: boolean }) {
  const full = options?.full ?? false;
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH, forceNew: full });
  await ensureKnowledgeCollection(store);
  if (full) {
    await store.removeCollection(KNOWLEDGE_COLLECTION);
    await store.addCollection(KNOWLEDGE_COLLECTION, { path: VAULT_ROOT, pattern: "**/*.md" });
    await ensureKnowledgeCollection(store);
  }
  const update = await store.update({ collections: [KNOWLEDGE_COLLECTION] });
  const status = await store.getStatus();
  return { store, update, status };
}

export async function embedKnowledgeIndex() {
  const store = await getQmdStore({ dbPath: QMD_INDEX_PATH });
  await ensureKnowledgeCollection(store);
  return store.embed({ chunkStrategy: "auto" });
}

export async function ensureKnowledgeCollection(store: Awaited<ReturnType<typeof getQmdStore>>) {
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

export function resolveAskRetrievalModeWithFreshness(
  question: string,
  options: { expand?: boolean; bm25?: boolean; sdkHybridAvailable?: boolean; status: KnowledgeIndexStatus },
): RetrievalMode {
  if (options.expand || options.bm25) {
    return resolveRetrievalMode(question, { expand: options.expand, bm25: options.bm25, sdkHybridAvailable: options.sdkHybridAvailable });
  }

  const vectorReady = options.status.hasVectorIndex && options.status.needsEmbedding === 0;
  if (!vectorReady) return "bm25";
  return resolveRetrievalMode(question, { sdkHybridAvailable: Boolean(options.sdkHybridAvailable) });
}
