import { dirname, join, relative } from "node:path";
import { existsSync } from "node:fs";
import matter from "gray-matter";
import { VAULT_ROOT } from "../constants";
import { orderFrontmatter, projectRoot, mkdirIfMissing, readProjectTitle } from "../cli-shared";
import { writeText } from "../lib/fs";
import { buildEvidenceExcerpt, buildScopedNoteIndex, findNoteByVaultPath, fromQmdFile, normalizePath, stripMarkdownExtension } from "../lib/notes";
import { assertQmdAvailable, buildLexicalSearchQuery, buildStructuredHybridQuery, classifyRetrievalIntent, normalizeSemanticQueryText, queryKnowledge, resolveRetrievalMode } from "../lib/qmd";
import { appendLogEntry } from "../lib/log";
import { sdkHybridAvailable, searchKnowledgeHybridSdk, searchKnowledgeLexicalSdk } from "../lib/qmd-sdk";
import { questionTokens } from "../lib/research";
import { createResearchPage } from "./research";
import type { AnswerBrief, AnswerSource, AskOptions, NoteIndex, QmdResult } from "../types";

export async function askProject(args: string[]) {
  assertQmdAvailable();
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  console.log(renderAnswerBrief(brief));
}

export async function fileAnswer(args: string[]) {
  assertQmdAvailable();
  const options = parseAskOptions(args);
  const brief = await buildAnswerBrief(options);
  const outputPath = resolveAnswerOutputPath(options.project, options.question, options.slug);
  mkdirIfMissing(dirname(outputPath));
  const contents = renderAnswerNote(brief);
  const existed = existsSync(outputPath);
  await writeText(outputPath, contents);
  appendLogEntry("file-answer", options.question, { project: options.project, details: [`path=${relative(VAULT_ROOT, outputPath)}`] });
  console.log(`${existed ? "updated" : "created"} ${relative(VAULT_ROOT, outputPath)}`);
  console.log(renderAnswerBrief(brief));
}

function parseAskOptions(args: string[]): AskOptions {
  let expand = false;
  let maxResults = 6;
  let slug: string | undefined;
  let project: string | undefined;
  const questionParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--expand") {
      expand = true;
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
  return { project, question, expand, maxResults, slug };
}

async function buildAnswerBrief(options: AskOptions): Promise<AnswerBrief> {
  const root = projectRoot(options.project);
  if (!existsSync(root)) throw new Error(`project not found: ${options.project}`);

  const maxCandidates = Math.max(10, options.maxResults * 3);
  const retrievalMode = resolveRetrievalMode(options.question, { expand: options.expand, sdkHybridAvailable: sdkHybridAvailable() });
  const retrievalQuery = options.expand
    ? options.question
    : retrievalMode === "bm25"
      ? buildProjectAwareLexicalQuery(options.project, options.question)
      : buildProjectAwareQuery(options.project, options.question);
  const qmdResults = await resolveRetrieval(retrievalMode, retrievalQuery, options.project, maxCandidates);
  const noteIndex = await buildScopedNoteIndex(qmdResults.map((result) => fromQmdFile(result.file)));
  const sources = qmdResults
    .map((result) => toAnswerSource(options.project, options.question, result, noteIndex))
    .filter((result, index, results) => results.findIndex((entry) => entry.vaultPath === result.vaultPath) === index)
    .sort((left, right) => (right.adjustedScore !== left.adjustedScore ? right.adjustedScore - left.adjustedScore : right.result.score - left.result.score));

  const allPrimarySources = sources.filter((source) => source.scope === "project");
  const strongPrimarySources = allPrimarySources.filter((source) => source.evidence.score >= 2);
  const primarySources = (strongPrimarySources.length >= 2 ? strongPrimarySources : allPrimarySources).slice(0, options.maxResults);
  const supportingSources = sources.filter((source) => source.scope !== "project").slice(0, Math.min(3, options.maxResults));
  const answerSources = strongPrimarySources.length ? strongPrimarySources.slice(0, options.maxResults) : [...primarySources];

  return {
    project: options.project,
    question: options.question,
    projectTitle: readProjectTitle(options.project),
    retrievalMode,
    retrievalQuery,
    answerSources,
    primarySources,
    supportingSources,
  };
}

async function resolveRetrieval(mode: string, query: string, project: string, maxCandidates: number): Promise<QmdResult[]> {
  if (mode === "expand") {
    return queryKnowledge(query, { expand: true, json: true, maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:expand` });
  }
  if (mode === "bm25") {
    return searchKnowledgeLexicalSdk(query, { maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:bm25` });
  }
  if (mode === "sdk-hybrid") {
    return searchKnowledgeHybridSdk(query, { maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:sdk-hybrid` });
  }
  return queryKnowledge(query, { expand: false, json: true, maxResults: maxCandidates, cacheKeyPrefix: `answer:${project}:structured` });
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

function questionPrefersResearch(question: string) {
  const normalized = question.toLowerCase();
  return /(why|compare|comparison|tradeoff|tradeoffs|decision|decisions|evidence|research|landscape|history|rationale)/u.test(normalized);
}

function toAnswerSource(project: string, question: string, result: QmdResult, noteIndex: NoteIndex): AnswerSource {
  const markdownPath = fromQmdFile(result.file);
  const vaultPath = stripMarkdownExtension(markdownPath);
  const note = findNoteByVaultPath(noteIndex, vaultPath);
  const scope = classifyAnswerScope(project, markdownPath);
  const evidence = buildEvidenceExcerpt(note, result, question);
  const adjustedScore = scoreAnswerSource(project, question, markdownPath, scope, result.score, evidence.score);
  return { result, adjustedScore, markdownPath, vaultPath, scope, note, evidence };
}

export function classifyAnswerScope(project: string, markdownPath: string): AnswerSource["scope"] {
  const normalized = normalizePath(markdownPath).toLowerCase();
  const projectPrefix = `projects/${project.toLowerCase()}/`;
  const researchProjectPrefix = `research/projects/${project.toLowerCase()}/`;
  if (normalized.startsWith(projectPrefix)) return "project";
  if (normalized.startsWith(researchProjectPrefix)) return "project";
  if (normalized.startsWith("wiki/")) return "wiki";
  if (normalized === "index.md" || normalized === "log.md" || normalized.startsWith("specs/") || normalized.startsWith("tools/") || normalized.startsWith("skills/") || normalized.startsWith("research/")) return "meta";
  return "other";
}

export function scoreAnswerSource(project: string, question: string, markdownPath: string, scope: AnswerSource["scope"], score: number, evidenceScore: number) {
  let adjusted = score;
  if (scope === "project") adjusted += 1.2;
  else if (scope === "wiki") adjusted += 0.2;
  else if (scope === "meta") adjusted -= 0.9;

  const normalized = normalizePath(markdownPath).toLowerCase();
  const projectPrefix = `projects/${project.toLowerCase()}/`;
  const prefersResearch = questionPrefersResearch(question);

  if (normalized === `${projectPrefix}_summary.md`) adjusted += 0.9;
  if (normalized === `${projectPrefix}decisions.md`) adjusted += 1.1;
  if (normalized === `${projectPrefix}specs/index.md`) adjusted += 1;
  if (normalized === `${projectPrefix}backlog.md`) adjusted += 0.2;
  if (normalized.startsWith(`${projectPrefix}specs/prds/prd-`)) adjusted += 0.75;
  if (normalized.startsWith(`${projectPrefix}specs/slices/`) && /\/(index|plan|test-plan)\.md$/u.test(normalized)) adjusted += 0.45;

  const lowerQuestion = question.toLowerCase();
  if (/\bprds?\b/u.test(lowerQuestion)) {
    if (normalized === `${projectPrefix}specs/index.md`) adjusted += 0.8;
    if (normalized.startsWith(`${projectPrefix}specs/prds/prd-`)) adjusted += 0.7;
  }
  if (/\b(slice|task)\b/u.test(lowerQuestion) && normalized.startsWith(`${projectPrefix}specs/slices/`)) adjusted += 0.45;
  if (/\bforge\b/u.test(lowerQuestion) && normalized === `${projectPrefix}decisions.md`) adjusted += 0.5;

  if (normalized.startsWith(`research/projects/${project.toLowerCase()}/`)) adjusted += prefersResearch ? 0.5 : -0.35;
  if (normalized.endsWith("/_overview.md")) adjusted += prefersResearch ? 0.1 : -0.45;
  if (normalized.endsWith("/spec.md")) adjusted += 0.25;
  if (normalized.endsWith("/readme.md")) adjusted -= 0.2;
  if (normalized.includes("/bench/")) adjusted -= 0.25;
  if (normalized.endsWith("/backlog.md") || normalized.includes("/verification/")) adjusted += 0.1;

  const topicBoost = questionTokens(question).reduce((total, token) => total + (normalized.includes(token) ? 0.08 : 0), 0);
  return adjusted + evidenceScore * 0.35 + Math.min(topicBoost, 0.4);
}

function renderAnswerBrief(brief: AnswerBrief) {
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

function renderAnswerNote(brief: AnswerBrief) {
  const sources = brief.answerSources.length ? brief.answerSources : [...brief.primarySources, ...brief.supportingSources];
  const data = orderFrontmatter({ title: `${brief.projectTitle} - ${brief.question}`, type: "synthesis", project: brief.project, updated: new Date().toISOString().slice(0, 10), status: "current", question: brief.question, retrieval_mode: brief.retrievalMode, source_paths: sources.map((source) => source.note ? normalizePath(relative(VAULT_ROOT, source.note.absolutePath)) : source.markdownPath).filter((value, index, values) => values.indexOf(value) === index) }, ["title", "type", "project", "updated", "status", "question", "retrieval_mode", "source_paths"]);
  const body = [`# ${brief.projectTitle} - ${brief.question}`, "", "## Question", "", brief.question, "", "## Answer", "", ...brief.answerSources.map((source) => `- ${renderAnswerBullet(source, brief.question)}`), "", "## Sources", "", ...sources.map((source, index) => `${index + 1}. ${renderSourceReference(source)}`), "", "## Retrieval", "", "| Field | Value |", "|-------|-------|", `| Mode | ${brief.retrievalMode} |`, `| Query | \`${brief.retrievalMode === "expand" ? brief.question : brief.retrievalMode === "bm25" ? "project-aware lexical" : "project-aware lex+vec"}\` |`, "", "```text", brief.retrievalQuery, "```", "", "## Cross Links", "", "- [[index]]", `- [[projects/${brief.project}/_summary|${brief.project} summary]]`, "- [[wiki/concepts/project-wiki-system]]", ...sources.map((source) => `- ${renderSourceLink(source)}`), ""].join("\n");
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
  const project = args[0];
  if (!project) throw new Error("missing project");
  const root = projectRoot(project);
  if (!existsSync(root)) throw new Error(`project not found: ${project}`);
  let topic: string | undefined;
  const titleParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--topic") {
      topic = args[index + 1];
      if (!topic) throw new Error("missing topic");
      index += 1;
      continue;
    }
    titleParts.push(arg);
  }
  const title = titleParts.join(" ").trim();
  if (!title) throw new Error("missing title");
  const { outputPath } = await createResearchPage(project, title, topic);
  appendLogEntry("file-research", title, { project, details: [`path=${relative(VAULT_ROOT, outputPath)}`] });
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}: ${value}`);
  return parsed;
}
