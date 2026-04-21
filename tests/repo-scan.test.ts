import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listRepoMarkdownDocs } from "../src/lib/repo-scan";
import { cleanupTempPaths, runGit, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("repo scan", () => {
  test("ignored markdown deletions disappear without cache-clear", async () => {
    const repo = tempDir("wiki-repo-scan");
    mkdirSync(join(repo, "ignored-output"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "ignored-output/\n", "utf8");
    writeFileSync(join(repo, "ignored-output", "report.md"), "# report\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", ".gitignore"]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

    const withReport = await listRepoMarkdownDocs(repo);
    expect(withReport).toContain("ignored-output/report.md");

    rmSync(join(repo, "ignored-output", "report.md"));

    const afterDelete = await listRepoMarkdownDocs(repo);
    expect(afterDelete).not.toContain("ignored-output/report.md");
  });
});
