import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupBroadBindingFixture(broad: boolean) {
  const vault = tempDir("wf145-broad-vault");
  const repo = tempDir("wf145-broad-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  const sourcePaths: string[] = [];
  for (let i = 0; i < 30; i++) {
    const relPath = `src/file-${i}.ts`;
    sourcePaths.push(relPath);
    writeFileSync(join(repo, relPath), `export const value${i} = ${i}\n`, "utf8");
  }
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf145b"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf145b");
  const pagesDir = join(vault, "projects", "wf145b", "architecture");
  mkdirSync(pagesDir, { recursive: true });
  const bindingBlock = broad ? "binding:\n  broad: true\n" : "";
  writeFileSync(
    join(pagesDir, "src-layout.md"),
    `---\ntitle: src layout\ntype: notes\nproject: wf145b\nsource_paths:\n${sourcePaths.map((path) => `  - ${path}`).join("\n")}\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n${bindingBlock}---\n# src layout\n`,
    "utf8",
  );

  return { repo, env };
}

function setupBroadBindingContentChangeFixture() {
  const vault = tempDir("wf145-broad-change-vault");
  const repo = tempDir("wf145-broad-change-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  const sourcePaths: string[] = [];
  for (let i = 0; i < 30; i++) {
    const relPath = `src/file-${i}.ts`;
    sourcePaths.push(relPath);
    writeFileSync(join(repo, relPath), `export const value${i} = ${i}\n`, "utf8");
  }
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "file-0.ts"), "export const value0 = 99\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf145bc"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf145bc");
  const pagesDir = join(vault, "projects", "wf145bc", "architecture");
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(
    join(pagesDir, "src-layout.md"),
    `---\ntitle: src layout\ntype: notes\nproject: wf145bc\nsource_paths:\n${sourcePaths.map((path) => `  - ${path}`).join("\n")}\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\nbinding:\n  broad: true\n---\n# src layout\n`,
    "utf8",
  );

  return { repo, env };
}

describe("WIKI-FORGE-145 broad-binding opt-out", () => {
  test("binding.broad=true suppresses mtime-only checkpoint staleness", () => {
    const { repo, env } = setupBroadBindingFixture(true);

    const result = runWiki(["checkpoint", "wf145b", "--repo", repo, "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.clean).toBe(true);
    expect(payload.stalePages).toEqual([]);
  });

  test("binding.broad omitted keeps existing checkpoint behavior", () => {
    const { repo, env } = setupBroadBindingFixture(false);

    const result = runWiki(["checkpoint", "wf145b", "--repo", repo, "--json"], env);

    expect(result.exitCode).not.toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.clean).toBe(false);
    expect(payload.stalePages.some((page: { page: string }) => page.page === "architecture/src-layout.md")).toBe(true);
  });

  test("binding.broad=true still reports the page when source content changed", () => {
    const { repo, env } = setupBroadBindingContentChangeFixture();

    const result = runWiki(["refresh-from-git", "wf145bc", "--repo", repo, "--base", "HEAD~1", "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.impactedPages.some((page: { page: string }) => page.page === "architecture/src-layout.md")).toBe(true);
  });
});
