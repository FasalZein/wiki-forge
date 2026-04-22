import { afterEach, describe, expect, test } from "bun:test";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";
import { countOutputTokens } from "../src/lib/token-budget";

afterEach(() => {
  cleanupTempPaths();
});

function setupWorkflowFixture() {
  const { vault, repo } = setupPassingRepo();
  const env = { KNOWLEDGE_VAULT_ROOT: vault };

  expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo);
  expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
  expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
  expect(runWiki(["create-issue-slice", "demo", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
  expect(runWiki(["start-slice", "demo", "DEMO-001", "--repo", repo], env).exitCode).toBe(0);

  return { env, repo };
}

describe("operator output token budgets", () => {
  test("default help stays within the workflow-first token budget", () => {
    const result = runWiki(["help"]);
    expect(result.exitCode).toBe(0);
    expect(countOutputTokens(result.stdout.toString())).toBeLessThanOrEqual(400);
  });

  test("full help catalog stays within the reference token budget", () => {
    const result = runWiki(["help", "--all"]);
    expect(result.exitCode).toBe(0);
    expect(countOutputTokens(result.stdout.toString())).toBeLessThanOrEqual(2400);
  });

  test("resume stays within the compact session-start budget", () => {
    const { env, repo } = setupWorkflowFixture();
    const result = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD"], env);
    expect(result.exitCode).toBe(0);
    expect(countOutputTokens(result.stdout.toString())).toBeLessThanOrEqual(360);
  });

  test("forge next stays within the compact steering budget", () => {
    const { env } = setupWorkflowFixture();
    const result = runWiki(["forge", "next", "demo"], env);
    expect(result.exitCode).toBe(0);
    expect(countOutputTokens(result.stdout.toString())).toBeLessThanOrEqual(200);
  });
});
