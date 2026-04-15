import { describe, expect, test } from "bun:test";
import { findNoteByVaultPath, buildEvidenceExcerpt } from "../src/lib/notes";
import type { NoteIndex, NoteInfo, QmdResult } from "../src/types";

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
