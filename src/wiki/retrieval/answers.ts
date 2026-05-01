import { dirname, join, relative } from "node:path"; // desloppify:ignore *
import matter from "gray-matter";
import { VAULT_ROOT } from "../../constants";
import { orderFrontmatter, projectRoot, mkdirIfMissing, readProjectTitle } from "../../cli-shared";
import { exists, writeText } from "../../lib/fs";
import { buildEvidenceExcerpt, buildScopedNoteIndex, fromQmdFile, normalizePath } from "../../lib/notes";
import { buildLexicalSearchQuery, normalizeSemanticQueryText } from "../../lib/qmd";
import { appendLogEntry } from "../../lib/log";
import { sdkHybridAvailable, searchKnowledgeExpandedSdk, searchKnowledgeLexicalSdk, searchKnowledgeStructuredSdk } from "../../lib/qmd-sdk";
import { refreshKnowledgeIndex, resolveAskRetrievalModeWithFreshness } from "./qmd-freshness";
import { resolveDirectProjectReferenceResults } from "./project-references";
import { createResearchPage } from "../research";
import { selectAnswerSources } from "./answer-source-selection";
import type { AnswerBrief, AnswerSource, AskOptions, QmdResult } from "../../types";
import { printLine } from "../../lib/cli-output";

export const DEFAULT_ASK_MAX_RESULTS = 4;
const DEFAULT_ASK_CANDIDATES = 8;
const DEFAULT_COMPACT_SOURCE_REFS = 3;

export async function askProject(args: string[]) {
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  printLine(renderAnswerBrief(brief, { verbose: options.verbose }));
}

export async function fileAnswer(args: string[]) {
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  const outputPath = resolveAnswerOutputPath(options.project, options.question, options.slug);
  await mkdirIfMissing(dirname(outputPath));
  const contents = renderAnswerNote(brief);
  const existed = await exists(outputPath);
  await writeText(outputPath, contents);
  appendLogEntry("file-answer", options.question, { project: options.project, details: [`path=${relative(VAULT_ROOT, outputPath)}`] });
  printLine(`${existed ? "updated" : "created"} ${relative(VAULT_ROOT, outputPath)}`);
  printLine(renderAnswerBrief(brief, { verbose: options.verbose }));
}

function parseAskOptions(args: string[]): AskOptions {
  let expand = false;
  let useBm25 = false;
  let verbose = false;
  let maxResults = DEFAULT_ASK_MAX_RESULTS;
  let slug: string | undefined;
  let project: string | undefined;
  const questionParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--expand") {
      expand = true;
      continue;
    }
    if (arg === "--bm25") {
      useBm25 = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "-n" || arg === "--max-results") {
      const value = args[index + 1];
      if (!value) throw new Error(`missing ${arg} value`);
      maxResults = parsePositiveInteger(value, arg);
      index += 1;
      continue;
    }
    if (arg === "--slug") {
      const value = args[index + 1];
      if (!value) throw new Error("missing slug");
      slug = slugify(value);
      index += 1;
      continue;
    }
    if (!project) {
      project = arg;
      continue;
    }
    questionParts.push(arg);
  }

  if (!project) throw new Error("missing project");
  const question = questionParts.join(" ").trim().replace(/\s+/g, " ");
  if (!question) throw new Error("missing question");
  return { project, question, expand, bm25: useBm25, verbose, maxResults, slug };
}

async function buildAnswerBrief(options: AskOptions): Promise<AnswerBrief> {
  const root = projectRoot(options.project);
  if (!await exists(root)) throw new Error(`project not found: ${options.project}`);

  const maxCandidates = resolveAskCandidateLimit(options.maxResults);
  const [hybridAvailable, indexFreshness] = await Promise.all([sdkHybridAvailable(), refreshKnowledgeIndex()]);
  const retrievalMode = resolveAskRetrievalModeWithFreshness(options.question, {
    expand: options.expand,
    bm25: options.bm25,
    sdkHybridAvailable: hybridAvailable,
    status: indexFreshness.status,
  });
  const retrievalQuery = options.expand
    ? options.question
    : retrievalMode === "bm25"
      ? buildProjectAwareLexicalQuery(options.project, options.question)
      : buildProjectAwareQuery(options.project, options.question);
  const [directResults, qmdResults] = await Promise.all([
    resolveDirectProjectReferenceResults(options.project, options.question),
    resolveRetrieval(retrievalMode, retrievalQuery, options.project, maxCandidates),
  ]);
  const candidateResults = mergeQmdResults([...directResults, ...qmdResults]);
  const noteIndex = await buildScopedNoteIndex(candidateResults.map((result) => fromQmdFile(result.file)));
  const sources = selectAnswerSources(options.project, options.question, candidateResults, noteIndex);

  const allPrimarySources = sources.filter((source) => source.scope === "project");
  const strongPrimarySources = allPrimarySources.filter((source) => source.evidence.score >= 2);
  const primarySources = (strongPrimarySources.length >= 2 ? strongPrimarySources : allPrimarySources).slice(0, options.maxResults);
  const supportingSources = sources.filter((source) => source.scope !== "project").slice(0, Math.min(3, options.maxResults));
  const answerSources = strongPrimarySources.length ? strongPrimarySources.slice(0, options.maxResults) : [...primarySources];

  return {
    project: options.project,
    question: options.question,
    projectTitle: await readProjectTitle(options.project),
    retrievalMode,
    retrievalQuery,
    answerSources,
    primarySources,
    supportingSources,
  };
}

async function resolveRetrieval(mode: string, query: string, project: string, maxCandidates: number): Promise<QmdResult[]> {
  const strategy = resolveAnswerRetrievalStrategy(mode);
  if (strategy === "sdk-expand") {
    return searchKnowledgeExpandedSdk(query, { maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:expand` });
  }
  if (strategy === "sdk-bm25") {
    return searchKnowledgeLexicalSdk(query, { maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:bm25` });
  }
  if (strategy === "sdk-structured") {
    return searchKnowledgeStructuredSdk(query, { maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:sdk-structured` });
  }
  return searchKnowledgeStructuredSdk(query, { maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:sdk-hybrid` });
}

function buildProjectAwareQuery(project: string, question: string) {
  const cleanQuestion = question.replace(/\s+/g, " ").trim();
  const projectTerms = normalizeSemanticQueryText(project);
  return [
    `intent: Answer a question about project ${project}. Prefer maintained docs under projects/${project}/ and related wiki pages.`,
    `lex: ${cleanQuestion}`,
    `lex: ${projectTerms} ${cleanQuestion}`,
    `vec: ${normalizeSemanticQueryText(`${cleanQuestion} ${projectTerms}`)}`,
  ].join("\n");
}

function buildProjectAwareLexicalQuery(project: string, question: string) {
  const projectTerms = normalizeSemanticQueryText(project).split(/\s+/u).filter(Boolean);
  const terms = [...buildLexicalSearchQuery(question).split(/\s+/u).filter(Boolean), ...projectTerms];
  const deduped = terms.filter((term, index) => terms.indexOf(term) === index);
  return deduped.join(" ").trim() || question;
}

export function resolveAnswerRetrievalStrategy(mode: string) {
  if (mode === "expand") return "sdk-expand" as const;
  if (mode === "bm25") return "sdk-bm25" as const;
  if (mode === "sdk-hybrid") return "sdk-hybrid" as const;
  return "sdk-structured" as const;
}

function mergeQmdResults(results: QmdResult[]) {
  const byFile = new Map<string, QmdResult>();
  for (const result of results) {
    const key = fromQmdFile(result.file).toLowerCase();
    if (!byFile.has(key)) byFile.set(key, result);
  }
  return [...byFile.values()];
}

export function resolveAskCandidateLimit(maxResults: number) {
  return Math.max(DEFAULT_ASK_CANDIDATES, maxResults * 2);
}

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
  const refs = sources.map((source) => renderSourceLink(source)).filter((value, index, values) => values.indexOf(value) === index).slice(0, DEFAULT_COMPACT_SOURCE_REFS);
  if (refs.length) lines.push("", `Sources: ${refs.join(" | ")}`);
  return lines.join("\n");
}

function renderAnswerNote(brief: AnswerBrief) {
  const sources = brief.answerSources.length ? brief.answerSources : [...brief.primarySources, ...brief.supportingSources];
  const data = orderFrontmatter({ title: `${brief.projectTitle} - ${brief.question}`, type: "synthesis", project: brief.project, updated: new Date().toISOString().slice(0, 10), status: "current", question: brief.question, retrieval_mode: brief.retrievalMode, source_paths: sources.map((source) => source.note ? normalizePath(relative(VAULT_ROOT, source.note.absolutePath)) : source.markdownPath).filter((value, index, values) => values.indexOf(value) === index) }, ["title", "type", "project", "updated", "status", "question", "retrieval_mode", "source_paths"]);
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

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function resolveAnswerOutputPath(project: string, question: string, slug?: string) {
  return join(VAULT_ROOT, "wiki", "syntheses", `${project}-${slug ?? slugify(question)}.md`);
}

function slugify(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return truncate(normalized || "answer", 72).replace(/[^a-z0-9-]+/g, "");
}

export async function fileResearch(args: string[]) {
  const topic = args[0];
  if (!topic) throw new Error("missing topic");
  let project: string | undefined;
  const titleParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") {
      project = args[index + 1];
      if (!project) throw new Error("missing project");
      index += 1;
      continue;
    }
    titleParts.push(arg);
  }
  const title = titleParts.join(" ").trim();
  if (!title) throw new Error("missing title");
  if (project) {
    const root = projectRoot(project);
    if (!await exists(root)) throw new Error(`project not found: ${project}`);
  }
  const { outputPath } = await createResearchPage(topic, title, project);
  appendLogEntry("file-research", title, { ...(project ? { project } : {}), details: [`topic=${topic}`, `path=${relative(VAULT_ROOT, outputPath)}`] });
  printLine(`created ${relative(VAULT_ROOT, outputPath)}`);
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}: ${value}`);
  return parsed;
}
