export type RetrievalIntent = "location" | "rationale" | "general";

export type RetrievalMode = "bm25" | "sdk-hybrid" | "structured-hybrid" | "expand";

export function normalizeSemanticQueryText(query: string) {
  return query
    .replace(/\r?\n+/g, " ")
    .replace(/(^|\s)-(?=(?:\p{L}|\p{N}|"))/gu, "$1")
    .replace(/(?<=\p{L}|\p{N})[-_/]+(?=\p{L}|\p{N})/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildStructuredHybridQuery(query: string, options?: { intent?: string }) {
  const lines: string[] = [];
  if (options?.intent) lines.push(`intent: ${options.intent}`);
  lines.push(`lex: ${query}`);
  lines.push(`vec: ${normalizeSemanticQueryText(query)}`);
  return lines.join("\n");
}

export function resolveRetrievalMode(query: string, options?: { expand?: boolean; bm25?: boolean; sdkHybridAvailable?: boolean }): RetrievalMode {
  if (options?.expand) return "expand";
  if (options?.bm25) return "bm25";
  if (options?.sdkHybridAvailable) return "sdk-hybrid";
  return classifyRetrievalIntent(query) === "rationale" ? "structured-hybrid" : "bm25";
}

export function classifyRetrievalIntent(query: string): RetrievalIntent {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (/(^|\b)(where|which|what)\b/u.test(normalized) && /(\b(file|files|doc|docs|page|pages|module|modules|spec|specs|prd|prds|slice|slices|task|tasks|folder|folders|route|routes)\b|\blive\b|\blocated\b|\bimplemented\b|\bdefined\b|\bstored\b|\bkept\b|\bowned\b)/u.test(normalized)) {
    return "location";
  }
  if (/(^|\b)(why|compare|comparison|tradeoff|tradeoffs|decision|decisions|rationale|history|landscape)\b/u.test(normalized)) {
    return "rationale";
  }
  return "general";
}

export function buildLexicalSearchQuery(query: string) {
  const normalizedQuestion = query.toLowerCase();
  const baseTerms = query
    .split(/[^a-z0-9-]+/iu)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^(where|which|what|does|do|how|live|lives|about|into|with|from|this|that|there)$/u.test(token.toLowerCase()));
  const hints: string[] = [];
  if (/\bprds?\b/u.test(normalizedQuestion)) hints.push("prd", "spec", "specs");
  if (/\b(slice|task)\b/u.test(normalizedQuestion)) hints.push("slice", "task", "specs", "plan", "test-plan");
  if (/\b(module|modules)\b/u.test(normalizedQuestion)) hints.push("module", "spec");
  if (/\b(file|files|doc|docs|page|pages)\b/u.test(normalizedQuestion)) hints.push("docs", "page", "spec");
  if (/\b(decision|decisions|forge)\b/u.test(normalizedQuestion)) hints.push("decisions", "forge");
  const terms = [...baseTerms, ...hints];
  const deduped = terms.filter((term, index) => terms.indexOf(term) === index);
  return deduped.join(" ").trim() || query;
}
