import { VAULT_ROOT } from "../constants";
import { assertQmdAvailable, buildStructuredHybridQuery, captureQmd, runQmd, runQmdCached } from "../lib/qmd";

export async function searchVault(args: string[]) {
  assertQmdAvailable();
  const hybrid = args[0] === "--hybrid";
  if (hybrid) console.warn("warning: 'wiki search --hybrid' overlaps with 'wiki query'. Prefer 'wiki query' for hybrid retrieval.");
  const query = (hybrid ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }

  if (hybrid) {
    await runQmdCached(["query", buildStructuredHybridQuery(query), "-c", "knowledge"], `search:hybrid:${query}`);
    return;
  }

  await runQmdCached(["search", query, "-c", "knowledge"], `search:${query}`);
}

export async function queryVault(args: string[]) {
  assertQmdAvailable();
  const expand = args[0] === "--expand";
  const query = (expand ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    throw new Error("missing query");
  }

  if (expand) {
    await runQmdCached(["query", query, "-c", "knowledge"], `query:expand:${query}`);
    return;
  }

  await runQmdCached(["query", buildStructuredHybridQuery(query), "-c", "knowledge"], `query:structured:${query}`);
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
  const list = await captureQmd(["collection", "list"]);
  if (!list.stdout.includes("knowledge")) {
    await runQmd(["collection", "add", VAULT_ROOT, "--name", "knowledge", "--mask", "**/*.md"]);
  }

  const contexts = await captureQmd(["context", "list"]);
  if (!contexts.stdout.includes("Knowledge vault: projects, wiki, research")) {
    await runQmd(["context", "add", "qmd://knowledge", "Knowledge vault: projects, wiki, research"]);
  }
  if (!contexts.stdout.includes("Use index.md first, then _summary.md, then drill deeper.")) {
    await runQmd(["context", "add", "/", "Use index.md first, then _summary.md, then drill deeper."]);
  }

  await runQmd(["update"]);
}
