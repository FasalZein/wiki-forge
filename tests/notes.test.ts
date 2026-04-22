import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findNoteByVaultPath, buildEvidenceExcerpt } from "../src/lib/notes";
import type { NoteIndex, NoteInfo, QmdResult } from "../src/types";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function makeNoteIndex(): NoteIndex {
  return {
    byVaultPath: new Map(),
    byVaultPathLower: new Map(),
    byBasename: new Map(),
    byAlias: new Map(),
  };
}

function indexNote(index: NoteIndex, note: NoteInfo) {
  index.byVaultPath.set(note.vaultPath, note);
  index.byVaultPathLower.set(note.vaultPath.toLowerCase(), note);
}

function makeNote(vaultPath: string, content = ""): NoteInfo {
  return {
    absolutePath: `/vault/${vaultPath}`,
    vaultPath,
    basename: vaultPath.split("/").pop() ?? vaultPath,
    aliases: [],
    headings: new Set(),
    content,
  };
}

function makeQmdResult(snippet = ""): QmdResult {
  return {
    docid: "test-id",
    file: "projects/test/page.md",
    title: "Test Page",
    snippet,
    score: 0.5,
  };
}

function buildIndexedNote(vault: string, relPath: string) {
  const script = `
    const { buildNoteIndex } = await import("./src/lib/notes");
    const index = await buildNoteIndex();
    const note = index.byVaultPath.get(${JSON.stringify(relPath.replace(/\.md$/u, ""))});
    if (!note) throw new Error("note missing from index");
    console.log(JSON.stringify({
      vaultPath: note.vaultPath,
      aliases: note.aliases,
      headings: [...note.headings],
    }));
  `;
  const proc = Bun.spawnSync(["bun", "-e", script], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, KNOWLEDGE_VAULT_ROOT: vault },
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || "buildNoteIndex subprocess failed");
  }
  return JSON.parse(proc.stdout.toString().trim()) as { vaultPath: string; aliases: string[]; headings: string[] };
}

function buildAliasMatches(vault: string, alias: string) {
  const script = `
    const { buildNoteIndex } = await import("./src/lib/notes");
    const index = await buildNoteIndex();
    const matches = (index.byAlias.get(${JSON.stringify(alias.toLowerCase())}) ?? []).map((note) => note.vaultPath);
    console.log(JSON.stringify(matches));
  `;
  const proc = Bun.spawnSync(["bun", "-e", script], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, KNOWLEDGE_VAULT_ROOT: vault },
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || "buildNoteIndex alias subprocess failed");
  }
  return JSON.parse(proc.stdout.toString().trim()) as string[];
}

describe("findNoteByVaultPath", () => {
  test("finds note by exact vault path", () => {
    const index = makeNoteIndex();
    const note = makeNote("projects/demo/spec.md");
    indexNote(index, note);
    expect(findNoteByVaultPath(index, "projects/demo/spec.md")).toBe(note);
  });

  test("finds note by case-insensitive vault path", () => {
    const index = makeNoteIndex();
    const note = makeNote("projects/Demo/Spec.md");
    indexNote(index, note);
    expect(findNoteByVaultPath(index, "projects/demo/spec.md")).toBe(note);
  });

  test("returns null for missing vault path", () => {
    const index = makeNoteIndex();
    expect(findNoteByVaultPath(index, "projects/missing/page.md")).toBeNull();
  });
});

describe("buildEvidenceExcerpt", () => {
  test("returns snippet text when note is null", () => {
    const result = makeQmdResult("relevant snippet from qmd");
    const excerpt = buildEvidenceExcerpt(null, result, "what is auth");
    expect(excerpt.text).toBe("relevant snippet from qmd");
    expect(excerpt.lineNumber).toBeNull();
  });

  test("returns fallback text for empty snippet and null note", () => {
    const result = makeQmdResult("");
    const excerpt = buildEvidenceExcerpt(null, result, "what is auth");
    expect(excerpt.text).toBe("Relevant context retrieved by qmd.");
  });

  test("finds the best matching line from note content", () => {
    const content = "## Overview\n\nThis page covers authentication tokens and sessions.\n\nUnrelated line here.";
    const note = makeNote("projects/demo/auth.md", content);
    const result = makeQmdResult("fallback snippet");
    const excerpt = buildEvidenceExcerpt(note, result, "authentication tokens");
    expect(excerpt.text).toContain("authentication tokens");
    expect(excerpt.lineNumber).toBeGreaterThan(0);
    expect(excerpt.score).toBeGreaterThan(0);
  });

  test("falls back to snippet when no content lines match query tokens", () => {
    const note = makeNote("projects/demo/page.md", "completely unrelated\ncontent here");
    const result = makeQmdResult("qmd snippet");
    const excerpt = buildEvidenceExcerpt(note, result, "zzzzzznotfound");
    expect(excerpt.text).toBe("qmd snippet");
    expect(excerpt.lineNumber).toBeNull();
  });

  test("truncates long evidence text", () => {
    const longLine = "authentication token: " + "x".repeat(300);
    const note = makeNote("projects/demo/page.md", longLine);
    const result = makeQmdResult("");
    const excerpt = buildEvidenceExcerpt(note, result, "authentication token");
    expect(excerpt.text.length).toBeLessThanOrEqual(223); // 220 + "..."
  });
});

describe("buildNoteIndex", () => {
  test("does not turn malformed frontmatter into fake heading slugs", () => {
    const vault = tempDir("notes-vault");
    mkdirSync(join(vault, "projects", "demo"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    writeFileSync(join(vault, "projects", "demo", "page.md"), `---
aliases: [oops
updated: 2026-04-22
---
# Real Heading
`, "utf8");

    const note = buildIndexedNote(vault, "projects/demo/page.md");
    expect(note.headings).toEqual(["real-heading"]);
  });

  test("keeps all notes for shared aliases", () => {
    const vault = tempDir("notes-alias-vault");
    mkdirSync(join(vault, "projects", "demo"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    writeFileSync(join(vault, "projects", "demo", "first.md"), `---
aliases:
  - Shared Alias
---
# First
`, "utf8");
    writeFileSync(join(vault, "projects", "demo", "second.md"), `---
aliases:
  - Shared Alias
---
# Second
`, "utf8");

    expect(buildAliasMatches(vault, "Shared Alias")).toEqual([
      "projects/demo/first",
      "projects/demo/second",
    ]);
  });
});
