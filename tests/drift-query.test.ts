import { describe, test } from "bun:test";

describe("drift-query", () => {
  // collectDriftSummary is the only exported function. It requires a fully
  // scaffolded vault project with bound wiki pages AND a real git repo with
  // committed source files. The existing CLI smoke tests already exercise this
  // path end-to-end through the drift-check and maintain commands. Adding a
  // direct unit test here would duplicate that integration coverage without
  // meaningfully improving isolation since the function orchestrates git
  // queries, file I/O, and vault resolution — none of which are independently
  // testable without mocks (which this codebase does not use).
  test.skip("collectDriftSummary is integration-tested via CLI smoke tests", () => {});
});
