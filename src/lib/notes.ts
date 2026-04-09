import { basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { QUERY_STOP_WORDS, VAULT_ROOT } from "../constants";
import type { NoteIndex, NoteInfo, QmdResult } from "../types";
import { filesFingerprint, readCache, writeCache } from "./cache";
import { fromQmdFile, isNonMarkdownAttachment, normalizePath, stripMarkdownExtension, toVaultPath, walkMarkdown } from "./vault";

const NOTE_INDEX_CACHE_VERSION = "1";

type SerializedNoteIndex = {
  notes: Array<{
    absolutePath: string;
    vaultPath: string;
    basename: string;
    aliases: string[];
    headings: string[];
  }>;
};

export function buildNoteIndex(): NoteIndex {
  const files = walkMarkdown(VAULT_ROOT);
  const fingerprint = filesFingerprint(files);
  const cached = readCache<SerializedNoteIndex>("note-index", "vault", NOTE_INDEX_CACHE_VERSION, fingerprint);
  if (cached) {
    return deserializeNoteIndex(cached);
  }

  const index = createEmptyNoteIndex();
  for (const file of files) {
    const note = buildNoteInfo(file, true);
    if (note) {
      indexNote(index, note);
    }
  }

  writeCache("note-index", "vault", NOTE_INDEX_CACHE_VERSION, fingerprint, serializeNoteIndex(index));
  return index;
}

export function buildScopedNoteIndex(markdownPaths: string[]): NoteIndex {
  const index = createEmptyNoteIndex();
  const uniquePaths = markdownPaths.filter((value, index, values) => values.indexOf(value) === index);
  for (const markdownPath of uniquePaths) {
    const note = buildNoteInfo(join(VAULT_ROOT, markdownPath), false);
    if (note) {
      indexNote(index, note);
    }
  }
  return index;
}

export function findNoteByVaultPath(noteIndex: NoteIndex, vaultPath: string) {
  return noteIndex.byVaultPath.get(vaultPath) ?? noteIndex.byVaultPathLower.get(vaultPath.toLowerCase()) ?? null;
}

export function buildEvidenceExcerpt(note: NoteInfo | null, result: QmdResult, question: string) {
  if (!note) {
    return { text: cleanSnippet(result.snippet), lineNumber: null, score: 0 };
  }

  const raw = note.content ?? readFileSync(note.absolutePath, "utf8");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const tokens = extractQueryTokens(question, note.vaultPath);
  let bestLine: { lineNumber: number; score: number; text: string } | null = null;

  for (const [index, line] of lines.entries()) {
    const score = scoreLineForTokens(line, tokens);
    if (score === 0) continue;
    const text = line.trim();
    if (!text) continue;
    if (!bestLine || score > bestLine.score) {
      bestLine = { lineNumber: index + 1, score, text };
    }
  }

  if (!bestLine) {
    return { text: cleanSnippet(result.snippet), lineNumber: null, score: 0 };
  }

  return {
    text: truncate(bestLine.text.replace(/\s+/g, " ").trim(), 220),
    lineNumber: bestLine.lineNumber,
    score: bestLine.score,
  };
}

export { fromQmdFile, isNonMarkdownAttachment, normalizePath, stripMarkdownExtension };

function buildNoteInfo(file: string, includeHeadings: boolean): NoteInfo | null {
  if (!existsSync(file)) {
    return null;
  }

  const raw = readFileSync(file, "utf8");
  const parsed = safeMatter(file, raw, { silent: true });
  const vaultPath = toVaultPath(file);
  return {
    absolutePath: file,
    vaultPath,
    basename: basename(vaultPath),
    aliases: extractAliases(parsed?.data ?? {}),
    headings: includeHeadings ? extractHeadingSlugs(parsed?.content ?? raw) : new Set<string>(),
    content: raw,
  };
}

function createEmptyNoteIndex(): NoteIndex {
  return {
    byVaultPath: new Map<string, NoteInfo>(),
    byVaultPathLower: new Map<string, NoteInfo>(),
    byBasename: new Map<string, NoteInfo[]>(),
    byAlias: new Map<string, NoteInfo[]>(),
  };
}

function indexNote(index: NoteIndex, note: NoteInfo) {
  index.byVaultPath.set(note.vaultPath, note);
  index.byVaultPathLower.set(note.vaultPath.toLowerCase(), note);
  pushIndex(index.byBasename, note.basename.toLowerCase(), note);
  for (const alias of note.aliases) {
    pushIndex(index.byAlias, alias.toLowerCase(), note);
  }
}

function serializeNoteIndex(index: NoteIndex): SerializedNoteIndex {
  return {
    notes: [...index.byVaultPath.values()].map((note) => ({
      absolutePath: note.absolutePath,
      vaultPath: note.vaultPath,
      basename: note.basename,
      aliases: note.aliases,
      headings: [...note.headings],
    })),
  };
}

function deserializeNoteIndex(serialized: SerializedNoteIndex): NoteIndex {
  const index = createEmptyNoteIndex();
  for (const note of serialized.notes) {
    indexNote(index, {
      absolutePath: note.absolutePath,
      vaultPath: note.vaultPath,
      basename: note.basename,
      aliases: note.aliases,
      headings: new Set(note.headings),
    });
  }
  return index;
}

function extractQueryTokens(question: string, vaultPath: string): string[] {
  const rawTokens = question
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 4)
    .filter((token) => !QUERY_STOP_WORDS.has(token));

  const projectBits = vaultPath.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
  return rawTokens.filter((token, index) => rawTokens.indexOf(token) === index && !projectBits.includes(token));
}

function scoreLineForTokens(line: string, tokens: string[]) {
  const normalized = line.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function cleanSnippet(snippet: string) {
  const lines = snippet
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line, index) => !(index === 0 && line.startsWith("@@ ")))
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "Relevant context retrieved by qmd.";
  }

  return truncate(lines.join(" ").replace(/\s+/g, " "), 220);
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function extractAliases(data: Record<string, unknown>): string[] {
  const rawAliases = data.aliases ?? data.alias;
  if (typeof rawAliases === "string") {
    return [rawAliases];
  }
  if (Array.isArray(rawAliases)) {
    return rawAliases.filter((value): value is string => typeof value === "string");
  }
  return [];
}

function extractHeadingSlugs(body: string): Set<string> {
  const tree = unified().use(remarkParse).parse(body) as { children?: unknown[] };
  const headings = new Set<string>();
  const slugger = new GithubSlugger();

  visit(tree, (node) => {
    if (!node || typeof node !== "object") return;
    if ((node as { type?: string }).type !== "heading") return;
    const text = toPlainText(node);
    if (!text) return;
    headings.add(slugger.slug(text));
  });

  return headings;
}

function visit(node: unknown, visitor: (node: unknown) => void) {
  visitor(node);
  if (!node || typeof node !== "object") return;
  const children = (node as { children?: unknown[] }).children;
  if (!children) return;
  for (const child of children) {
    visit(child, visitor);
  }
}

function toPlainText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const value = (node as { value?: unknown }).value;
  if (typeof value === "string") {
    return value;
  }
  const children = (node as { children?: unknown[] }).children;
  if (!children) {
    return "";
  }
  return children.map((child) => toPlainText(child)).join("");
}

function pushIndex(map: Map<string, NoteInfo[]>, key: string, note: NoteInfo) {
  const current = map.get(key) ?? [];
  current.push(note);
  map.set(key, current);
}

function safeMatter(pathLabel: string, content: string, options?: { silent?: boolean }) {
  try {
    return matter(content) as { content: string; data: Record<string, unknown> };
  } catch (error) {
    if (!options?.silent) {
      console.warn(`warning: could not parse frontmatter for ${pathLabel}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
