import { assertQmdAvailable, ensureKnowledgeCollection, queryKnowledge, runQmd, searchKnowledge } from "../lib/qmd";

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

  await queryKnowledge(query, { expand });
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

export async function qmdSetup() {
  assertQmdAvailable();
  await ensureKnowledgeCollection();
  await runQmd(["update"]);
  await runQmd(["embed"]);
}
