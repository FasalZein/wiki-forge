import type { VerificationLevel } from "./constants";

export type CommandHandler = (args: string[]) => Promise<void> | void;
export type FrontmatterData = Record<string, unknown>;

export type NoteInfo = {
  absolutePath: string;
  vaultPath: string;
  basename: string;
  aliases: string[];
  headings: Set<string>;
  content?: string;
};

export type NoteIndex = {
  byVaultPath: Map<string, NoteInfo>;
  byVaultPathLower: Map<string, NoteInfo>;
  byBasename: Map<string, NoteInfo[]>;
  byAlias: Map<string, NoteInfo[]>;
};

export type AskOptions = {
  project: string;
  question: string;
  expand: boolean;
  verbose: boolean;
  maxResults: number;
  slug?: string;
};

export type OnboardPlanOptions = {
  project: string;
  repo?: string;
  write: boolean;
};

export type QmdResult = {
  docid: string;
  score: number;
  file: string;
  title: string;
  context?: string;
  snippet: string;
};

export type AnswerSource = {
  result: QmdResult;
  adjustedScore: number;
  markdownPath: string;
  vaultPath: string;
  scope: "project" | "wiki" | "meta" | "other";
  note: NoteInfo | null;
  evidence: { text: string; lineNumber: number | null; score: number };
};

export type AnswerBrief = {
  project: string;
  question: string;
  projectTitle: string;
  retrievalMode: "bm25" | "sdk-hybrid" | "structured-hybrid" | "expand";
  retrievalQuery: string;
  answerSources: AnswerSource[];
  primarySources: AnswerSource[];
  supportingSources: AnswerSource[];
};

export type ParsedEntry = {
  file: string;
  relPath: string;
  sourcePaths: string[];
  wikiUpdated: Date | null;
  currentLevel: VerificationLevel | null;
  rawUpdated: unknown;
};
