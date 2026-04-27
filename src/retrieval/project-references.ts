import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { VAULT_ROOT } from "../constants";
import type { QmdResult } from "../types";

export function extractCanonicalReferenceIds(question: string) {
  const matches = question.match(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+\b/giu) ?? []; // desloppify:ignore EMPTY_ARRAY_FALLBACK
  return matches.map((match) => match.toUpperCase()).filter((match, index, values) => values.indexOf(match) === index);
}

export async function resolveDirectProjectReferenceResults(project: string, question: string): Promise<QmdResult[]> {
  const results: QmdResult[] = [];
  for (const id of extractCanonicalReferenceIds(question)) {
    const markdownPath = findProjectReferenceMarkdownPath(project, id);
    if (!markdownPath) continue;
    const absolutePath = join(VAULT_ROOT, markdownPath);
    const raw = await Bun.file(absolutePath).text();
    const parsed = matter(raw);
    const title = typeof parsed.data.title === "string" ? parsed.data.title : firstMarkdownHeading(parsed.content) ?? id;
    results.push({
      docid: `direct:${id}`,
      score: 1,
      file: markdownPath,
      title,
      snippet: `@@ -1,1 @@\n${buildDirectReferenceSnippet(id, parsed.content, title)}`,
    });
  }
  return results;
}

export function findProjectReferenceMarkdownPath(project: string, id: string): string | null {
  if (/^PRD-\d+$/u.test(id)) return findProjectSpecFile(project, "prds", id);
  if (/^FEAT-\d+$/u.test(id)) return findProjectSpecFile(project, "features", id);
  const slicePath = `projects/${project}/specs/slices/${id}/index.md`;
  if (existsSync(join(VAULT_ROOT, slicePath))) return slicePath;
  const lowerSlicePath = `projects/${project}/specs/slices/${id.toLowerCase()}/index.md`;
  if (existsSync(join(VAULT_ROOT, lowerSlicePath))) return lowerSlicePath;
  return null;
}

export function selectSpecMarkdownFileForId(entries: string[], id: string) {
  const normalizedId = id.toLowerCase();
  const markdownEntries = entries.filter((entry) => entry.toLowerCase().endsWith(".md"));
  const exact = markdownEntries.find((entry) => entry.toLowerCase() === `${normalizedId}.md`);
  if (exact) return exact;
  return markdownEntries.find((entry) => entry.toLowerCase().startsWith(`${normalizedId}-`)) ?? null;
}

function findProjectSpecFile(project: string, family: "features" | "prds", id: string) {
  const dir = join(VAULT_ROOT, "projects", project, "specs", family);
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir);
  const match = selectSpecMarkdownFileForId(entries, id);
  return match ? `projects/${project}/specs/${family}/${match}` : null;
}

function buildDirectReferenceSnippet(id: string, content: string, title: string) {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("> [!") && !line.startsWith("---"))
    .filter((line) => !/^#+\s*$/u.test(line))
    .slice(0, 8);
  return truncate([title, ...lines].filter(Boolean).join(" "), 220) || id;
}

function firstMarkdownHeading(content: string) {
  return content.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? null;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
