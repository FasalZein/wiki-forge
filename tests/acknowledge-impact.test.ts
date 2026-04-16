import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runGit, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki acknowledge-impact (WIKI-FORGE-104)", () => {
  test("stamps verified_against with HEAD sha and filters acknowledged pages from refresh-from-git", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "ack"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "ack");
    expect(runWiki(["create-module", "ack", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    // baseline: refresh-from-git should flag the auth module because src/auth.ts changed
    const before = runWiki(["refresh-from-git", "ack", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(before.exitCode).toBe(0);
    const beforeJson = JSON.parse(before.stdout.toString());
    expect(beforeJson.impactedPages.some((p: { page: string }) => p.page === "modules/auth/spec.md")).toBe(true);

    // get HEAD sha for comparison
    const headResult = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo, stdout: "pipe" });
    const headSha = headResult.stdout.toString().trim();

    // acknowledge the impacted page
    const ack = runWiki(["acknowledge-impact", "ack", "modules/auth/spec.md", "--repo", repo, "--json"], env);
    expect(ack.exitCode).toBe(0);
    const ackJson = JSON.parse(ack.stdout.toString());
    expect(ackJson.sha).toBe(headSha);
    expect(ackJson.updated).toHaveLength(1);
    expect(ackJson.updated[0].page).toBe("modules/auth/spec.md");

    // frontmatter should now contain verified_against
    const pageContent = readFileSync(join(vault, "projects", "ack", "modules", "auth", "spec.md"), "utf8");
    expect(pageContent).toContain(`verified_against: ${headSha}`);

    // re-run refresh-from-git: acknowledged page should no longer appear in impactedPages
    const after = runWiki(["refresh-from-git", "ack", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(after.exitCode).toBe(0);
    const afterJson = JSON.parse(after.stdout.toString());
    expect(afterJson.impactedPages.some((p: { page: string }) => p.page === "modules/auth/spec.md")).toBe(false);
    expect(afterJson.acknowledgedPages).toContain("modules/auth/spec.md");
  });

  test("re-appears after further source commits invalidate the acknowledgement", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "ack2"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "ack2");
    expect(runWiki(["create-module", "ack2", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    // acknowledge at current HEAD
    expect(runWiki(["acknowledge-impact", "ack2", "modules/auth/spec.md", "--repo", repo], env).exitCode).toBe(0);

    // add a new commit touching src/auth.ts
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "third"]);

    // refresh-from-git should now resurface the page since sha no longer matches
    const after = runWiki(["refresh-from-git", "ack2", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(after.exitCode).toBe(0);
    const afterJson = JSON.parse(after.stdout.toString());
    expect(afterJson.impactedPages.some((p: { page: string }) => p.page === "modules/auth/spec.md")).toBe(true);
  });

  test("requires at least one page argument", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "ackerr"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "ackerr");

    const result = runWiki(["acknowledge-impact", "ackerr", "--repo", repo], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("at least one page");
  });
});
