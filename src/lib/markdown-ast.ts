/**
 * Shared mdast-based markdown parser for wiki pages.
 * Replaces 5+ regex parsing sites with one typed AST parse per file.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { toString } from "mdast-util-to-string";
import type { Root, Content, Heading, Code, ListItem, Paragraph, Strong, Text } from "mdast";

// ── Types ───────────────────────────────────────────────────────────

export interface WikiHeading {
  depth: number;
  text: string;
}

export interface WikiTask {
  id: string;
  title: string;
  checked: boolean;
}

export interface WikiLink {
  target: string;
  anchor: string | null;
  alias: string | null;
}

export interface WikiCodeBlock {
  lang: string | null;
  value: string;
}

export interface ParsedWikiMarkdown {
  headings: WikiHeading[];
  tasks: WikiTask[];
  wikilinks: WikiLink[];
  codeBlocks: WikiCodeBlock[];
  todoCount: number;
  bodyLength: number;
  bodyText: string;
}

// ── Wikilink regex ──────────────────────────────────────────────────
// Obsidian [[target#anchor|alias]] — kept as regex because the AST
// plugin ecosystem for wikilinks is fragile and this pattern is
// unambiguous in wiki markdown.
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

// ── Bold task ID pattern ────────────────────────────────────────────
// Matches **PROJ-001** inside list item text
const BOLD_TASK_ID_RE = /^([A-Z0-9]+-\d+)\s+(.*)$/;

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Parse wiki markdown (body only, no frontmatter) into a typed result.
 * Pass the `.content` from gray-matter, not the raw file.
 */
export function parseWikiMarkdown(body: string): ParsedWikiMarkdown {
  const tree = fromMarkdown(body, {
    extensions: [gfmTaskListItem()],
    mdastExtensions: [gfmTaskListItemFromMarkdown()],
  });

  const headings: WikiHeading[] = [];
  const tasks: WikiTask[] = [];
  const codeBlocks: WikiCodeBlock[] = [];

  walkTree(tree, (node) => {
    switch (node.type) {
      case "heading": {
        const h = node as Heading;
        headings.push({ depth: h.depth, text: toString(h).trim() });
        break;
      }
      case "code": {
        const c = node as Code;
        codeBlocks.push({ lang: c.lang ?? null, value: c.value });
        break;
      }
      case "listItem": {
        const li = node as ListItem;
        if (li.checked !== null && li.checked !== undefined) {
          const task = extractTaskFromListItem(li);
          if (task) tasks.push(task);
        }
        break;
      }
    }
  });

  const wikilinks = extractWikilinks(body);
  const todoCount = countTodos(body);

  return {
    headings,
    tasks,
    wikilinks,
    codeBlocks,
    todoCount,
    bodyLength: body.length,
    bodyText: body,
  };
}

// ── Extraction helpers ──────────────────────────────────────────────

/**
 * Extract wikilinks from raw markdown body.
 * Returns targets, anchors, and aliases.
 */
export function extractWikilinks(body: string): WikiLink[] {
  // Strip fenced code blocks and inline code spans so wikilinks inside
  // code contexts (e.g. `[[example]]`) are not treated as real links.
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
  const links: WikiLink[] = [];
  for (const match of stripped.matchAll(WIKILINK_RE)) {
    links.push({
      target: match[1].trim(),
      anchor: match[2]?.trim() ?? null,
      alias: match[3]?.trim() ?? null,
    });
  }
  return links;
}

/**
 * Extract wikilink targets only (no anchor/alias), for lint compatibility.
 */
export function extractWikilinkTargets(body: string): string[] {
  return extractWikilinks(body).map((l) => l.target);
}

/**
 * Extract shell/bash code blocks from markdown body.
 */
export function extractShellBlocks(body: string): string[] {
  const parsed = parseWikiMarkdown(body);
  return parsed.codeBlocks
    .filter((b) => b.lang === "bash" || b.lang === "sh" || b.lang === "shell")
    .map((b) => b.value);
}

/**
 * Extract H2 section names from markdown body.
 */
export function extractH2Sections(body: string): string[] {
  const parsed = parseWikiMarkdown(body);
  return parsed.headings.filter((h) => h.depth === 2).map((h) => h.text);
}

/**
 * Check if a heading text exists in the markdown body.
 */
export function hasHeading(body: string, headingText: string): boolean {
  const parsed = parseWikiMarkdown(body);
  return parsed.headings.some((h) => h.text === headingText);
}

// ── Internal helpers ────────────────────────────────────────────────

function extractTaskFromListItem(li: ListItem): WikiTask | null {
  // Walk to find the first paragraph → strong → text pattern
  // Expected: - [ ] **TASK-001** Title text here
  const paragraph = li.children?.find((c): c is Paragraph => c.type === "paragraph");
  if (!paragraph) return null;

  const strong = paragraph.children?.find((c): c is Strong => c.type === "strong");
  if (!strong) return null;

  const boldText = toString(strong).trim();
  // Get full paragraph text after the bold part
  const fullText = toString(paragraph).trim();

  // The full text starts with the bold text; the rest is the title
  if (fullText.startsWith(boldText)) {
    const rest = fullText.slice(boldText.length).trim();
    const idMatch = boldText.match(/^[A-Z0-9]+-\d+$/);
    if (idMatch) {
      return {
        id: boldText,
        title: rest,
        checked: !!li.checked,
      };
    }
  }

  return null;
}

function countTodos(body: string): number {
  // Intentionally counts ALL TODO occurrences including inside code blocks,
  // since these represent work items regardless of context.
  return (body.match(/\bTODO\b/g) || []).length;
}

function walkTree(node: Root | Content, visitor: (node: Content) => void) {
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children as Content[]) {
      visitor(child);
      walkTree(child, visitor);
    }
  }
}
