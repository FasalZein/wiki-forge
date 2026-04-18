import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

/**
 * Fixture: a repo with two source files. A single wiki page binds BOTH source files
 * (broad binding, like architecture/src-layout.md). A slice declares ownership of
 * only ONE of those files. A modification to the OTHER (out-of-slice) file changes
 * the page's mtime-based stale signal.
 *
 * F3 contract: under `--slice-local --slice-id`, the out-of-slice modified file
 * must NOT drive staleness for that slice.
 */
function setupBroadBindingFixture() {
  const vault = tempDir("wf141cp-vault");
  const repo = tempDir("wf141cp-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
  writeFileSync(join(repo, "src", "billing.ts"), "export const b = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  // Second commit: only billing.ts changes. auth.ts does not.
  writeFileSync(join(repo, "src", "billing.ts"), "export const b = 2\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

  // Backdate auth.ts mtime so it looks older than the page. billing.ts keeps its
  // recent mtime from the second commit. The F3 scenario is: broad-binding page,
  // slice owns only auth.ts (old), billing.ts (recent) is out-of-slice.
  const oldTime = new Date("2000-01-01T00:00:00Z");
  utimesSync(join(repo, "src", "auth.ts"), oldTime, oldTime);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf");
  // One issue slice owning ONLY src/auth.ts.
  expect(runWiki(["create-issue-slice", "wf", "auth slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);

  // Write a "broad binding" architecture page bound to BOTH source files.
  // Page's updated=2010 is newer than auth.ts mtime (2000) but older than billing.ts mtime (now).
  const pagesDir = join(vault, "projects", "wf", "architecture");
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(
    join(pagesDir, "src-layout.md"),
    "---\ntitle: src layout\ntype: notes\nproject: wf\nsource_paths:\n  - src/auth.ts\n  - src/billing.ts\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n---\n# src layout\n\nbroadly bound page.\n",
    "utf8",
  );

  return { vault, repo, env };
}

describe("WIKI-FORGE-141 slice-local checkpoint scope (F3)", () => {
  test("slice-local checkpoint ignores modified files outside the slice's source_paths", () => {
    const { vault, repo, env } = setupBroadBindingFixture();

    const result = runWiki([
      "checkpoint",
      "wf",
      "--repo",
      repo,
      "--slice-local",
      "--slice-id",
      "WF-001",
      "--json",
    ], env);

    // The broad-binding page bound to both files AND a modified out-of-slice file
    // used to report stale. Under --slice-local, only in-slice file changes count.
    // In-slice file (src/auth.ts) did NOT change, so stale should be 0.
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.clean).toBe(true);
    expect(payload.stalePages.length).toBe(0);
  });

  test("non-slice-local checkpoint still reports the broad-binding page as stale (no regression)", () => {
    const { vault, repo, env } = setupBroadBindingFixture();

    const result = runWiki(["checkpoint", "wf", "--repo", repo, "--json"], env);

    // Without --slice-local, ALL modified files count. The broad-binding page is stale.
    expect(result.exitCode).not.toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.clean).toBe(false);
    expect(payload.stalePages.some((p: { page: string }) => p.page === "architecture/src-layout.md")).toBe(true);
  });
});
