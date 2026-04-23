import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "../../test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("checkpoint semantic-neutral auto-heal", () => {
  test("auto-heals docs-only bound page churn unless strict freshness is requested", () => {
    const { vault, repo, env } = setupCheckpointFixture("freshdoc", [
      { path: "README.md", before: "# Demo\n\nOld docs\n", after: "# Demo\n\nNew docs\n" },
    ]);

    const strict = runWiki(["checkpoint", "freshdoc", "--repo", repo, "--base", "HEAD~1", "--strict-freshness", "--json"], env);
    expect(strict.exitCode).not.toBe(0);
    expect(strict.json<{ clean: boolean; stalePages: Array<{ page: string }> }>().clean).toBe(false);
    expect(strict.json<{ stalePages: Array<{ page: string }> }>().stalePages.some((page) => page.page === "architecture/readme.md")).toBe(true);

    const healed = runWiki(["checkpoint", "freshdoc", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(healed.exitCode).toBe(0);
    const payload = healed.json<{ clean: boolean; stalePages: unknown[]; autoHealed: { count: number; pages: Array<{ page: string }> } }>();
    expect(payload.clean).toBe(true);
    expect(payload.stalePages).toEqual([]);
    expect(payload.autoHealed.count).toBe(1);
    expect(payload.autoHealed.pages[0]?.page).toBe("architecture/readme.md");
    expect(readFileSync(join(vault, "projects", "freshdoc", "architecture", "readme.md"), "utf8")).toContain("freshness_healed_at:");
  });

  test("does not auto-heal semantic or mixed churn", () => {
    const semantic = setupCheckpointFixture("freshcode", [
      { path: "src/auth.ts", before: "export const auth = 1\n", after: "export const auth = 2\n" },
    ]);
    const semanticResult = runWiki(["checkpoint", "freshcode", "--repo", semantic.repo, "--base", "HEAD~1", "--json"], semantic.env);
    expect(semanticResult.exitCode).not.toBe(0);
    expect(semanticResult.json<{ autoHealed: { count: number } }>().autoHealed.count).toBe(0);

    const mixed = setupCheckpointFixture("freshmixed", [
      { path: "README.md", before: "# Demo\n\nOld docs\n", after: "# Demo\n\nNew docs\n" },
      { path: "src/auth.ts", before: "export const auth = 1\n", after: "export const auth = 2\n" },
    ]);
    const mixedResult = runWiki(["checkpoint", "freshmixed", "--repo", mixed.repo, "--base", "HEAD~1", "--json"], mixed.env);
    expect(mixedResult.exitCode).not.toBe(0);
    expect(mixedResult.json<{ autoHealed: { count: number } }>().autoHealed.count).toBe(0);
  });
});

function setupCheckpointFixture(project: string, files: Array<{ path: string; before: string; after: string }>) {
  const vault = tempDir(`${project}-vault`);
  const repo = tempDir(`${project}-repo`);
  initVault(vault);
  for (const file of files) {
    mkdirSync(join(repo, file.path.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(repo, file.path), file.before, "utf8");
  }
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  for (const file of files) writeFileSync(join(repo, file.path), file.after, "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "changed"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", project], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, project);
  const pageDir = join(vault, "projects", project, "architecture");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(
    join(pageDir, "readme.md"),
    `---\ntitle: readme\ntype: notes\nproject: ${project}\nsource_paths:\n${files.map((file) => `  - ${file.path}`).join("\n")}\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n---\n# Readme\n`,
    "utf8",
  );
  return { vault, repo, env };
}
