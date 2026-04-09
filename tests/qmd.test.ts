import { describe, expect, test } from "bun:test";
import { DEFAULT_CANDIDATE_LIMITS, parseCandidateLimitsArg } from "../scripts/qmd-bench";
import { resolveQmdIndexPath } from "../src/constants";
import { classifyAnswerScope, scoreAnswerSource } from "../src/commands/answers";
import { buildStructuredHybridQuery, normalizeSemanticQueryText } from "../src/lib/qmd";

describe("qmd query shaping", () => {
  test("normalizes hyphenated project names for semantic queries", () => {
    expect(normalizeSemanticQueryText("what is wiki-forge")).toBe("what is wiki forge");
  });

  test("strips unary negation syntax from semantic queries", () => {
    expect(normalizeSemanticQueryText('auth -legacy -"old flow"')).toBe('auth legacy "old flow"');
  });

  test("builds structured hybrid query with raw lex and normalized vec", () => {
    expect(buildStructuredHybridQuery("what is wiki-forge")).toBe([
      "lex: what is wiki-forge",
      "vec: what is wiki forge",
    ].join("\n"));
  });

  test("includes optional intent line before search lines", () => {
    expect(buildStructuredHybridQuery("how does qmd fit", { intent: "Answer a question about project wiki-forge." })).toBe([
      "intent: Answer a question about project wiki-forge.",
      "lex: how does qmd fit",
      "vec: how does qmd fit",
    ].join("\n"));
  });
});

describe("qmd index selection", () => {
  test("uses the default sqlite path for the default index", () => {
    expect(resolveQmdIndexPath("index")).toEndWith("/.cache/qmd/index.sqlite");
  });

  test("uses a named sqlite path for non-default indexes", () => {
    expect(resolveQmdIndexPath("wiki-forge-bench")).toEndWith("/.cache/qmd/wiki-forge-bench.sqlite");
  });
});

describe("benchmark harness config", () => {
  test("uses the expected default candidate limits", () => {
    expect(DEFAULT_CANDIDATE_LIMITS).toEqual([8, 16, 40]);
  });

  test("parses and normalizes candidate limit args", () => {
    expect(parseCandidateLimitsArg("40,8,16,8")).toEqual([8, 16, 40]);
  });
});

describe("answer reranking", () => {
  test("classifies project docs before wiki and meta docs", () => {
    expect(classifyAnswerScope("wiki-forge", "projects/wiki-forge/specs/index.md")).toBe("project");
    expect(classifyAnswerScope("wiki-forge", "wiki/concepts/project-wiki-system.md")).toBe("wiki");
    expect(classifyAnswerScope("wiki-forge", "specs/system-spec.md")).toBe("meta");
  });

  test("prefers project spec docs over research notes for location questions", () => {
    const projectScore = scoreAnswerSource("wiki-forge", "where do PRDs live", "projects/wiki-forge/specs/index.md", "project", 0.4, 1);
    const researchScore = scoreAnswerSource("wiki-forge", "where do PRDs live", "research/projects/wiki-forge/chronological-spec-ordering-and-auto-heal.md", "project", 0.4, 1);
    expect(projectScore).toBeGreaterThan(researchScore);
  });

  test("prefers the specs hub over generic project docs for PRD location questions", () => {
    const specIndexScore = scoreAnswerSource("wiki-forge", "where do PRDs live", "projects/wiki-forge/specs/index.md", "project", 0.4, 1);
    const decisionsScore = scoreAnswerSource("wiki-forge", "where do PRDs live", "projects/wiki-forge/decisions.md", "project", 0.4, 1);
    expect(specIndexScore).toBeGreaterThan(decisionsScore);
  });

  test("keeps project research competitive for rationale questions", () => {
    const researchScore = scoreAnswerSource("wiki-forge", "why did we move spec docs into task folders", "research/projects/wiki-forge/task-based-spec-folders-and-hubs.md", "project", 0.4, 1);
    const projectScore = scoreAnswerSource("wiki-forge", "why did we move spec docs into task folders", "projects/wiki-forge/specs/index.md", "project", 0.4, 1);
    expect(researchScore).toBeGreaterThan(1);
    expect(projectScore).toBeGreaterThan(0);
  });
});
