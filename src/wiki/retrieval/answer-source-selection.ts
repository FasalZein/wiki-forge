import matter from "gray-matter";
import { buildEvidenceExcerpt, findNoteByVaultPath, fromQmdFile, normalizePath, stripMarkdownExtension } from "../../lib/notes";
import { legacyProjectResearchTopic, questionTokens } from "../../lib/research";
import type { AnswerSource, NoteIndex, NoteInfo, NoteQualitySignals, QmdResult } from "../../types";

const VERIFICATION_LEVEL_BOOST: Record<string, number> = {
  "test-verified": 0.4,
  "runtime-verified": 0.3,
  "code-verified": 0.2,
  "inferred": 0,
  "scaffold": -0.3,
  "stale": -0.5,
};

const STATUS_BOOST: Record<string, number> = {
  "current": 0.1,
  "draft": 0,
  "deprecated": -0.4,
};

const RECENCY_THRESHOLDS = [
  { days: 7, boost: 0.2 },
  { days: 30, boost: 0.1 },
  { days: 90, boost: 0 },
] as const;
const RECENCY_STALE_PENALTY = -0.15;

export function selectAnswerSources(project: string, question: string, candidateResults: QmdResult[], noteIndex: NoteIndex): AnswerSource[] {
  const byVaultPath = new Map<string, AnswerSource>();
  for (const result of candidateResults) {
    const source = toAnswerSource(project, question, result, noteIndex);
    const key = source.vaultPath.toLowerCase();
    if (!byVaultPath.has(key)) byVaultPath.set(key, source);
  }
  return [...byVaultPath.values()].sort((left, right) => (right.adjustedScore !== left.adjustedScore ? right.adjustedScore - left.adjustedScore : right.result.score - left.result.score));
}

function toAnswerSource(project: string, question: string, result: QmdResult, noteIndex: NoteIndex): AnswerSource {
  const markdownPath = fromQmdFile(result.file);
  const vaultPath = stripMarkdownExtension(markdownPath);
  const note = findNoteByVaultPath(noteIndex, vaultPath);
  const scope = classifyAnswerScope(project, markdownPath, note);
  const evidence = buildEvidenceExcerpt(note, result, question);
  const adjustedScore = scoreAnswerSource(project, question, markdownPath, scope, result.score, evidence.score, note?.qualitySignals, note);
  return { result, adjustedScore, markdownPath, vaultPath, scope, note, evidence };
}

function questionPrefersResearch(question: string) {
  const normalized = question.toLowerCase();
  return /(why|compare|comparison|tradeoff|tradeoffs|decision|decisions|evidence|research|landscape|history|rationale)/u.test(normalized);
}

export function classifyAnswerScope(project: string, markdownPath: string, note?: NoteInfo | null): AnswerSource["scope"] {
  const normalized = normalizePath(markdownPath).toLowerCase();
  const projectPrefix = `projects/${project.toLowerCase()}/`;
  const researchTopicPrefix = `research/${project.toLowerCase()}/`;
  const legacyResearchProjectPrefix = `research/${legacyProjectResearchTopic(project).toLowerCase()}/`;
  if (normalized.startsWith(projectPrefix)) return "project";
  if (isProjectBoundResearch(project, normalized, note, researchTopicPrefix, legacyResearchProjectPrefix)) return "project";
  if (normalized.startsWith("wiki/")) return "wiki";
  if (normalized === "index.md" || normalized === "log.md" || normalized.startsWith("specs/") || normalized.startsWith("tools/") || normalized.startsWith("skills/") || normalized.startsWith("research/")) return "meta";
  return "other";
}

export function scoreAnswerSource(
  project: string,
  question: string,
  markdownPath: string,
  scope: AnswerSource["scope"],
  score: number,
  evidenceScore: number,
  qualitySignals?: NoteQualitySignals,
  note?: NoteInfo | null,
) {
  let adjusted = score;
  if (scope === "project") adjusted += 1.2;
  else if (scope === "wiki") adjusted += 0.2;
  else if (scope === "meta") adjusted -= 0.9;

  const normalized = normalizePath(markdownPath).toLowerCase();
  const projectPrefix = `projects/${project.toLowerCase()}/`;
  const researchTopicPrefix = `research/${project.toLowerCase()}/`;
  const legacyResearchProjectPrefix = `research/${legacyProjectResearchTopic(project).toLowerCase()}/`;
  const prefersResearch = questionPrefersResearch(question);
  const projectBoundResearch = isProjectBoundResearch(project, normalized, note, researchTopicPrefix, legacyResearchProjectPrefix);

  if (normalized === `${projectPrefix}_summary.md`) adjusted += 0.9;
  if (normalized === `${projectPrefix}decisions.md`) adjusted += 1.1;
  if (normalized === `${projectPrefix}architecture/domain-language.md`) adjusted += 1.05;
  if (normalized === `${projectPrefix}specs/index.md`) adjusted += 1;
  if (normalized === `${projectPrefix}backlog.md`) adjusted += 0.2;
  if (normalized.startsWith(`${projectPrefix}specs/features/feat-`)) adjusted += 0.55;
  if (normalized.startsWith(`${projectPrefix}specs/prds/prd-`)) adjusted += 0.75;
  if (normalized.startsWith(`${projectPrefix}specs/slices/`) && /\/(index|plan|test-plan)\.md$/u.test(normalized)) adjusted += 0.45;

  const lowerQuestion = question.toLowerCase();
  if (/\bfeatures?\b/u.test(lowerQuestion) && normalized.startsWith(`${projectPrefix}specs/features/feat-`)) adjusted += 0.6;
  if (/\bprds?\b/u.test(lowerQuestion)) {
    if (normalized === `${projectPrefix}specs/index.md`) adjusted += 0.8;
    if (normalized.startsWith(`${projectPrefix}specs/prds/prd-`)) adjusted += 0.7;
  }
  if (/\b(slice|task)\b/u.test(lowerQuestion) && normalized.startsWith(`${projectPrefix}specs/slices/`)) adjusted += 0.45;
  if (/\bforge\b/u.test(lowerQuestion) && normalized === `${projectPrefix}decisions.md`) adjusted += 0.5;
  if (/\b(term|terms|terminology|domain language|glossary)\b/u.test(lowerQuestion) && normalized === `${projectPrefix}architecture/domain-language.md`) adjusted += 0.8;
  if (/\b(why|decision|decisions|rationale|tradeoff|tradeoffs)\b/u.test(lowerQuestion) && normalized === `${projectPrefix}decisions.md`) adjusted += 0.5;

  if (projectBoundResearch) adjusted += prefersResearch ? 0.5 : -0.35;
  if (normalized.endsWith("/_overview.md")) adjusted += prefersResearch ? 0.1 : -0.45;
  if (normalized.endsWith("/spec.md")) adjusted += 0.25;
  if (normalized.endsWith("/readme.md")) adjusted -= 0.2;
  if (normalized.includes("/bench/")) adjusted -= 0.25;
  if (normalized.endsWith("/backlog.md") || normalized.includes("/verification/")) adjusted += 0.1;

  adjusted += qualitySignalBoost(qualitySignals);

  const topicBoost = questionTokens(question).reduce((total, token) => total + (normalized.includes(token) ? 0.08 : 0), 0);
  return adjusted + evidenceScore * 0.35 + Math.min(topicBoost, 0.4);
}

function isProjectBoundResearch(
  project: string,
  normalizedMarkdownPath: string,
  note: NoteInfo | null | undefined,
  researchTopicPrefix = `research/${project.toLowerCase()}/`,
  legacyResearchProjectPrefix = `research/${legacyProjectResearchTopic(project).toLowerCase()}/`,
) {
  if (!normalizedMarkdownPath.startsWith("research/")) return false;
  if (normalizedMarkdownPath.startsWith(researchTopicPrefix) || normalizedMarkdownPath.startsWith(legacyResearchProjectPrefix)) return true;
  const projectFromFrontmatter = readProjectFromNote(note);
  return projectFromFrontmatter === project.toLowerCase();
}

function readProjectFromNote(note: NoteInfo | null | undefined) {
  if (!note?.content) return null;
  let project: string | null = null;
  try {
    const parsed = matter(note.content);
    project = typeof parsed.data.project === "string" ? parsed.data.project.trim().toLowerCase() : null;
  } catch {
    project = null;
  }
  return project;
}

export function qualitySignalBoost(signals?: NoteQualitySignals): number {
  if (!signals) return 0;
  let boost = 0;
  if (signals.verificationLevel) {
    boost += VERIFICATION_LEVEL_BOOST[signals.verificationLevel] ?? 0;
  }
  if (signals.status) {
    boost += STATUS_BOOST[signals.status] ?? 0;
  }
  if (signals.updated) {
    boost += recencyBoost(signals.updated);
  }
  return boost;
}

function recencyBoost(updatedStr: string): number {
  const updated = new Date(updatedStr);
  if (Number.isNaN(updated.getTime())) return 0;
  const daysSince = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
  for (const threshold of RECENCY_THRESHOLDS) {
    if (daysSince <= threshold.days) return threshold.boost;
  }
  return RECENCY_STALE_PENALTY;
}
