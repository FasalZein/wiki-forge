import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { projectRoot, readProjectTitle } from "../../cli-shared";
import { exists } from "../../lib/fs";
import { buildScopedNoteIndex, fromQmdFile } from "../../lib/notes";
import { buildLexicalSearchQuery, normalizeSemanticQueryText } from "../../lib/qmd";
import { appendLogEntry } from "../../lib/log";
import { sdkHybridAvailable, searchKnowledgeExpandedSdk, searchKnowledgeLexicalSdk, searchKnowledgeStructuredSdk } from "../../lib/qmd-sdk";
import { refreshKnowledgeIndex, resolveAskRetrievalModeWithFreshness } from "./qmd-freshness";
import { resolveDirectProjectReferenceResults } from "./project-references";
import { createResearchPage } from "../research";
import { selectAnswerSources } from "./answer-source-selection";
import { fileAnswerBrief } from "./answer-filing";
import { renderAnswerBrief } from "./answer-rendering";
import type { AnswerBrief, AskOptions, QmdResult } from "../../types";
import { printLine } from "../../lib/cli-output";

export const DEFAULT_ASK_MAX_RESULTS = 4;
const DEFAULT_ASK_CANDIDATES = 8;

export async function askProject(args: string[]) {
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  printLine(renderAnswerBrief(brief, { verbose: options.verbose }));
}

export async function fileAnswer(args: string[]) {
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  const filed = await fileAnswerBrief(brief, options.slug);
  printLine(`${filed.existed ? "updated" : "created"} ${filed.relativePath}`);
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

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
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
