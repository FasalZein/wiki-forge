import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAllowedRepoMarkdownDoc, listRepoMarkdownDocs } from "../src/commands/repo-scan";
import { cleanupTempPaths, runGit, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("repo markdown allowlist", () => {
  test("listRepoMarkdownDocs skips skills/ subtree entirely", async () => {
    const repo = tempDir("wiki-repo-skills");
    mkdirSync(join(repo, "skills", "tdd"), { recursive: true });
    writeFileSync(join(repo, "skills", "tdd", "SKILL.md"), "# skill\n", "utf8");
    writeFileSync(join(repo, "skills", "tdd", "companion.md"), "# companion\n", "utf8");
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "guide.md"), "# guide\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

    const docs = await listRepoMarkdownDocs(repo);
    expect(docs.some((p) => p.startsWith("skills/"))).toBe(false);
    expect(docs).toContain("docs/guide.md");
  });

  test("isAllowedRepoMarkdownDoc accepts README and skill companion paths", () => {
    expect(isAllowedRepoMarkdownDoc("README.md")).toBe(true);
    expect(isAllowedRepoMarkdownDoc("CHANGELOG.md")).toBe(true);
    expect(isAllowedRepoMarkdownDoc("AGENTS.md")).toBe(true);
    expect(isAllowedRepoMarkdownDoc("CLAUDE.md")).toBe(true);
    expect(isAllowedRepoMarkdownDoc("skills/tdd/companion.md")).toBe(true);
    expect(isAllowedRepoMarkdownDoc("docs/guide.md")).toBe(false);
  });
});
