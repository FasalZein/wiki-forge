import { describe, expect, test } from "bun:test";
import { DEFAULT_CANDIDATE_LIMITS, parseCandidateLimitsArg } from "../scripts/qmd-bench";
import { DEFAULT_BENCH_COMMANDS, parseCommandList } from "../scripts/wiki-maintenance-bench";
import { resolveQmdIndexPath } from "../src/constants";
import { join } from "node:path";
import { DEFAULT_ASK_MAX_RESULTS, classifyAnswerScope, qualitySignalBoost, renderAnswerBrief, resolveAnswerRetrievalStrategy, resolveAskCandidateLimit, scoreAnswerSource } from "../src/commands/answers";
import { resolveQueryExecutionMode, resolveSearchRetrievalMode } from "../src/commands/qmd-commands";
import { VAULT_ROOT } from "../src/constants";
import { buildLexicalSearchQuery, buildStructuredHybridQuery, classifyRetrievalIntent, normalizeSemanticQueryText, resolveRetrievalMode } from "../src/lib/qmd";
import { fromQmdFile } from "../src/lib/vault";

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

describe("retrieval intent routing", () => {
  test("classifies location questions", () => {
    expect(classifyRetrievalIntent("where do PRDs live")).toBe("location");
    expect(classifyRetrievalIntent("which file owns auth routing")).toBe("location");
  });

  test("classifies rationale questions", () => {
    expect(classifyRetrievalIntent("why did we move specs into task folders")).toBe("rationale");
    expect(classifyRetrievalIntent("compare the tradeoffs of qmd search vs query")).toBe("rationale");
  });

  test("leaves other questions as general", () => {
    expect(classifyRetrievalIntent("how does verification work")).toBe("general");
  });

  test("routes general queries to bm25, not hybrid", () => {
    // Only rationale queries should use the expensive hybrid path
    expect(classifyRetrievalIntent("how does verification work")).not.toBe("rationale");
    expect(classifyRetrievalIntent("what is the cache layer")).not.toBe("rationale");
  });

  test("only rationale queries trigger hybrid retrieval", () => {
    expect(classifyRetrievalIntent("why did we choose qmd")).toBe("rationale");
    expect(classifyRetrievalIntent("compare BM25 vs vector search")).toBe("rationale");
    // General and location should both avoid hybrid
    expect(classifyRetrievalIntent("how does verification work")).not.toBe("rationale");
    expect(classifyRetrievalIntent("where do PRDs live")).not.toBe("rationale");
  });

  test("builds a tighter lexical query for location questions", () => {
    expect(buildLexicalSearchQuery("where do PRDs live")).toBe("PRDs prd spec specs");
    expect(buildLexicalSearchQuery("which file owns auth routing")).toContain("file");
  });
});

describe("retrieval mode resolution", () => {
  test("location queries resolve to bm25 mode", () => {
    expect(resolveRetrievalMode("where do PRDs live")).toBe("bm25");
  });

  test("general queries resolve to bm25 mode", () => {
    expect(resolveRetrievalMode("how does verification work")).toBe("bm25");
    expect(resolveRetrievalMode("what is the cache layer")).toBe("bm25");
  });

  test("rationale queries resolve to structured-hybrid when sdk hybrid unavailable", () => {
    expect(resolveRetrievalMode("why did we choose qmd")).toBe("structured-hybrid");
    expect(resolveRetrievalMode("compare BM25 vs vector search")).toBe("structured-hybrid");
  });

  test("all query intents resolve to sdk-hybrid when available", () => {
    expect(resolveRetrievalMode("why did we choose qmd", { sdkHybridAvailable: true })).toBe("sdk-hybrid");
    expect(resolveRetrievalMode("compare BM25 vs vector search", { sdkHybridAvailable: true })).toBe("sdk-hybrid");
    expect(resolveRetrievalMode("where do PRDs live", { sdkHybridAvailable: true })).toBe("sdk-hybrid");
    expect(resolveRetrievalMode("how does verification work", { sdkHybridAvailable: true })).toBe("sdk-hybrid");
  });

  test("--bm25 forces bm25 mode even when sdk hybrid available", () => {
    expect(resolveRetrievalMode("why did we choose qmd", { bm25: true, sdkHybridAvailable: true })).toBe("bm25");
    expect(resolveRetrievalMode("where do PRDs live", { bm25: true })).toBe("bm25");
  });

  test("expand flag overrides intent routing regardless of sdk hybrid", () => {
    expect(resolveRetrievalMode("where do PRDs live", { expand: true })).toBe("expand");
    expect(resolveRetrievalMode("why did we choose qmd", { expand: true })).toBe("expand");
    expect(resolveRetrievalMode("why did we choose qmd", { expand: true, sdkHybridAvailable: true })).toBe("expand");
  });
});

describe("search retrieval mode", () => {
  test("uses SDK BM25 for plain search queries", () => {
    expect(resolveSearchRetrievalMode({ hybrid: false, sdkHybridAvailable: false })).toBe("sdk-bm25");
  });

  test("uses SDK hybrid only when explicitly requested and available", () => {
    expect(resolveSearchRetrievalMode({ hybrid: true, sdkHybridAvailable: true })).toBe("sdk-hybrid");
    expect(resolveSearchRetrievalMode({ hybrid: true, sdkHybridAvailable: false })).toBe("structured-hybrid");
  });
});

describe("sdk execution strategy", () => {
  test("keeps structured fallback on the structured sdk path for query/search", () => {
    expect(resolveQueryExecutionMode("structured-hybrid")).toBe("sdk-structured");
    expect(resolveQueryExecutionMode("sdk-hybrid")).toBe("sdk-hybrid");
    expect(resolveQueryExecutionMode("expand")).toBe("sdk-expand");
  });

  test("keeps answer fallback on the structured sdk path", () => {
    expect(resolveAnswerRetrievalStrategy("structured-hybrid")).toBe("sdk-structured");
    expect(resolveAnswerRetrievalStrategy("sdk-hybrid")).toBe("sdk-hybrid");
    expect(resolveAnswerRetrievalStrategy("bm25")).toBe("sdk-bm25");
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

  test("uses the expected maintenance benchmark commands", () => {
    expect(DEFAULT_BENCH_COMMANDS).toEqual(["update-index", "maintain", "discover", "doctor", "gate", "drift-check", "bind", "verify-page"]);
  });

  test("parses and normalizes maintenance benchmark commands", () => {
    expect(parseCommandList("gate,update-index,gate,bind")).toEqual(["gate", "update-index", "bind"]);
  });
});

describe("ask defaults", () => {
  test("uses compact default limits for answer retrieval", () => {
    expect(DEFAULT_ASK_MAX_RESULTS).toBe(4);
    expect(resolveAskCandidateLimit(DEFAULT_ASK_MAX_RESULTS)).toBe(8);
    expect(resolveAskCandidateLimit(7)).toBe(14);
  });

  test("renders compact briefs by default and richer output in verbose mode", () => {
    const source = {
      result: { docid: "1", score: 0.87, file: "projects/wiki-forge/specs/index.md", title: "specs index", snippet: "PRDs live under specs/prds" },
      adjustedScore: 2.1,
      markdownPath: "projects/wiki-forge/specs/index.md",
      vaultPath: "projects/wiki-forge/specs/index",
      scope: "project" as const,
      note: { absolutePath: "/tmp/projects/wiki-forge/specs/index.md", vaultPath: "projects/wiki-forge/specs/index", basename: "index", aliases: [], headings: new Set() },
      evidence: { text: "PRDs live under specs/prds.", lineNumber: 12, score: 3 },
    };
    const brief = {
      project: "wiki-forge",
      question: "where do PRDs live",
      projectTitle: "Wiki Forge",
      retrievalMode: "bm25" as const,
      retrievalQuery: "PRDs prd spec specs wiki forge",
      answerSources: [source],
      primarySources: [source],
      supportingSources: [],
    };

    const compact = renderAnswerBrief(brief);
    const verbose = renderAnswerBrief(brief, { verbose: true });

    expect(compact).toContain("Sources: [[projects/wiki-forge/specs/index|specs index]]");
    expect(compact).not.toContain("Question:");
    expect(compact).not.toContain("Routing:");
    expect(verbose).toContain("Question: where do PRDs live");
    expect(verbose).toContain("Routing:");
    expect(compact.length).toBeLessThan(verbose.length);
  });
});

describe("answer reranking", () => {
  test("normalizes absolute SDK result paths back into project markdown paths", () => {
    const absolute = join(VAULT_ROOT, "projects", "wiki-forge", "specs", "index.md");
    const normalized = fromQmdFile(absolute);
    expect(normalized).toBe("projects/wiki-forge/specs/index.md");
    expect(classifyAnswerScope("wiki-forge", normalized)).toBe("project");
  });

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

describe("quality-signal score boosting", () => {
  const basePath = "projects/wiki-forge/specs/index.md";
  const baseArgs = ["wiki-forge", "where do PRDs live", basePath, "project" as const, 0.4, 1] as const;

  test("test-verified pages score higher than scaffold pages", () => {
    const testVerified = scoreAnswerSource(...baseArgs, { verificationLevel: "test-verified", status: "current" });
    const scaffold = scoreAnswerSource(...baseArgs, { verificationLevel: "scaffold", status: "current" });
    expect(testVerified).toBeGreaterThan(scaffold);
  });

  test("code-verified pages score higher than scaffold pages", () => {
    const codeVerified = scoreAnswerSource(...baseArgs, { verificationLevel: "code-verified", status: "current" });
    const scaffold = scoreAnswerSource(...baseArgs, { verificationLevel: "scaffold", status: "current" });
    expect(codeVerified).toBeGreaterThan(scaffold);
  });

  test("recently updated pages score higher than stale pages", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 3);
    const old = new Date();
    old.setDate(old.getDate() - 180);
    const recentScore = scoreAnswerSource(...baseArgs, { updated: recent.toISOString().slice(0, 10) });
    const oldScore = scoreAnswerSource(...baseArgs, { updated: old.toISOString().slice(0, 10) });
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  test("deprecated pages penalized vs current pages", () => {
    const current = scoreAnswerSource(...baseArgs, { status: "current" });
    const deprecated = scoreAnswerSource(...baseArgs, { status: "deprecated" });
    expect(current).toBeGreaterThan(deprecated);
  });

  test("returns zero boost when no quality signals present", () => {
    expect(qualitySignalBoost(undefined)).toBe(0);
    expect(qualitySignalBoost({})).toBe(0);
  });

  test("unknown verification levels contribute zero boost", () => {
    expect(qualitySignalBoost({ verificationLevel: "unknown-level" })).toBe(0);
  });

  test("verification level ordering is monotonic from scaffold to test-verified", () => {
    const levels = ["scaffold", "inferred", "code-verified", "runtime-verified", "test-verified"];
    const boosts = levels.map((level) => qualitySignalBoost({ verificationLevel: level }));
    for (let i = 1; i < boosts.length; i++) {
      expect(boosts[i]).toBeGreaterThanOrEqual(boosts[i - 1]);
    }
  });

  test("existing tests still pass without quality signals (backward compatible)", () => {
    const withoutSignals = scoreAnswerSource("wiki-forge", "where do PRDs live", "projects/wiki-forge/specs/index.md", "project", 0.4, 1);
    const withEmptySignals = scoreAnswerSource("wiki-forge", "where do PRDs live", "projects/wiki-forge/specs/index.md", "project", 0.4, 1, {});
    expect(withoutSignals).toBe(withEmptySignals);
  });
});
