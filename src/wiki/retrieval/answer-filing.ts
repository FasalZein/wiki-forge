import { dirname, join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { mkdirIfMissing } from "../../cli-shared";
import { exists, writeText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import type { AnswerBrief } from "../../types";
import { renderAnswerNote } from "./answer-rendering";

export type FiledAnswer = {
  readonly outputPath: string;
  readonly relativePath: string;
  readonly existed: boolean;
};

export async function fileAnswerBrief(brief: AnswerBrief, slug?: string): Promise<FiledAnswer> {
  const outputPath = resolveAnswerOutputPath(brief.project, brief.question, slug);
  await mkdirIfMissing(dirname(outputPath));
  const existed = await exists(outputPath);
  await writeText(outputPath, renderAnswerNote(brief));
  const relativePath = relative(VAULT_ROOT, outputPath);
  appendLogEntry("file-answer", brief.question, { project: brief.project, details: [`path=${relativePath}`] });
  return { outputPath, relativePath, existed };
}

function resolveAnswerOutputPath(project: string, question: string, slug?: string) {
  return join(VAULT_ROOT, "wiki", "syntheses", `${project}-${slug ?? slugify(question)}.md`);
}

function slugify(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return truncate(normalized || "answer", 72).replace(/[^a-z0-9-]+/g, "");
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
