import { relative } from "node:path";
import matter from "gray-matter";
import { VAULT_ROOT } from "../../constants";
import { orderFrontmatter } from "../../cli-shared";
import { buildEvidenceExcerpt, normalizePath } from "../../lib/notes";
import type { AnswerBrief, AnswerSource } from "../../types";

const DEFAULT_COMPACT_SOURCE_REFS = 3;

export function renderAnswerBrief(brief: AnswerBrief, options?: { verbose?: boolean }) {
  if (options?.verbose) {
    const lines = [`Question: ${brief.question}`, `Project: ${brief.projectTitle} (${brief.project})`, `Mode: ${brief.retrievalMode}`, "", "Routing:", "- [[index]]", `- [[projects/${brief.project}/_summary|${brief.project} summary]]`, "", "Answer Brief:"];
    for (const source of brief.answerSources) lines.push(`- ${renderAnswerBullet(source, brief.question)}`);
    lines.push("", "Primary Sources:");
    for (const [index, source] of brief.primarySources.entries()) lines.push(`${index + 1}. ${renderSourceReference(source)}`);
    if (brief.supportingSources.length) {
      lines.push("", "Supporting Sources:");
      for (const [index, source] of brief.supportingSources.entries()) lines.push(`${index + 1}. ${renderSourceReference(source)}`);
    }
    return lines.join("\n");
  }

  const sources = brief.answerSources.length ? brief.answerSources : [...brief.primarySources, ...brief.supportingSources];
  if (!sources.length) return `No answer sources found for: ${brief.question}`;
  const lines = sources.map((source) => `- ${renderAnswerBullet(source, brief.question)}`);
  const refs = dedupeStrings(sources.map((source) => renderSourceLink(source))).slice(0, DEFAULT_COMPACT_SOURCE_REFS);
  if (refs.length) lines.push("", `Sources: ${refs.join(" | ")}`);
  return lines.join("\n");
}

export function renderAnswerNote(brief: AnswerBrief) {
  const sources = brief.answerSources.length ? brief.answerSources : [...brief.primarySources, ...brief.supportingSources];
  const data = orderFrontmatter({ title: `${brief.projectTitle} - ${brief.question}`, type: "synthesis", project: brief.project, updated: new Date().toISOString().slice(0, 10), status: "current", question: brief.question, retrieval_mode: brief.retrievalMode, source_paths: dedupeStrings(sources.map((source) => source.note ? normalizePath(relative(VAULT_ROOT, source.note.absolutePath)) : source.markdownPath)) }, ["title", "type", "project", "updated", "status", "question", "retrieval_mode", "source_paths"]);
  let retrievalQueryLabel: string;
  if (brief.retrievalMode === "expand") retrievalQueryLabel = brief.question;
  else if (brief.retrievalMode === "bm25") retrievalQueryLabel = "project-aware lexical";
  else retrievalQueryLabel = "project-aware lex+vec";
  const body = [`# ${brief.projectTitle} - ${brief.question}`, "", "## Question", "", brief.question, "", "## Answer", "", ...brief.answerSources.map((source) => `- ${renderAnswerBullet(source, brief.question)}`), "", "## Sources", "", ...sources.map((source, index) => `${index + 1}. ${renderSourceReference(source)}`), "", "## Retrieval", "", "| Field | Value |", "|-------|-------|", `| Mode | ${brief.retrievalMode} |`, `| Query | \`${retrievalQueryLabel}\` |`, "", "```text", brief.retrievalQuery, "```", "", "## Cross Links", "", "- [[index]]", `- [[projects/${brief.project}/_summary|${brief.project} summary]]`, "- [[wiki/concepts/project-wiki-system]]", ...sources.map((source) => `- ${renderSourceLink(source)}`), ""].join("\n");
  return matter.stringify(body, data);
}

function renderAnswerBullet(source: AnswerSource, question: string) {
  const evidence = source.evidence.score > 0 ? source.evidence : buildEvidenceExcerpt(source.note, source.result, question);
  const citation = evidence.lineNumber ? `${renderSourceLink(source)}:${evidence.lineNumber}` : renderSourceLink(source);
  return `${citation} - ${evidence.text}`;
}

function renderSourceReference(source: AnswerSource) {
  return `${renderSourceLink(source)} | ${source.scope} | ${Math.round(source.result.score * 100)}%`;
}

function renderSourceLink(source: AnswerSource) {
  return source.note ? `[[${source.note.vaultPath}|${source.result.title}]]` : `\`${source.markdownPath}\``;
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}
