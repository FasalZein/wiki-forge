import { assertQmdAvailable, buildLexicalSearchQuery, classifyRetrievalIntent, ensureKnowledgeCollection, queryKnowledge, runQmd, searchKnowledge } from "../lib/qmd";
import { searchKnowledgeLexicalSdk } from "../lib/qmd-sdk";

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

  if (expand) {
    await queryKnowledge(query, { expand: true });
    return;
  }
  if (classifyRetrievalIntent(query) === "location") {
    const results = await searchKnowledgeLexicalSdk(buildLexicalSearchQuery(query), { maxResults: 5, cacheKeyPrefix: "query:sdk-location" });
    console.log(renderQueryResults(results));
    return;
  }
  await queryKnowledge(query, { expand: false });
}

export async function qmdStatus() {
  assertQmdAvailable();
  await runQmd(["status"]);
}

export async function qmdUpdate() {
  assertQmdAvailable();
  await runQmd(["update"]);
}

export async function qmdEmbed() {
  assertQmdAvailable();
  await runQmd(["embed"]);
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
  await ensureKnowledgeCollection();
  await runQmd(["update"]);
  await runQmd(["embed"]);
}
