import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupSliceFixture(includeHelperInSourcePaths: boolean) {
  const vault = tempDir("wf145-slice-vault");
  const repo = tempDir("wf145-slice-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "new-helper.ts"), "export const helper = 1\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf145s"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf145s");
  expect(runWiki(["create-issue-slice", "wf145s", "drift warning slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);

  const sliceDir = join(vault, "projects", "wf145s", "specs", "slices", "WF145S-001");
  const indexPath = join(sliceDir, "index.md");
  const currentIndex = readFileSync(indexPath, "utf8");
  const extraSource = includeHelperInSourcePaths ? "\n  - src/new-helper.ts" : "";
  writeFileSync(
    indexPath,
    currentIndex
      .replace("source_paths:\n  - src/auth.ts", `source_paths:\n  - src/auth.ts${extraSource}`)
      .replace("created_at:", "started_at: '2000-01-01T00:00:00.000Z'\ncreated_at:"),
    "utf8",
  );
  writeFileSync(
    join(sliceDir, "test-plan.md"),
    "---\ntitle: WIKI-FORGE-145 slice drift\ntype: spec\nspec_kind: test-plan\nproject: wf145s\ntask_id: WF145S-001\nupdated: 2026-04-18\nstatus: current\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] shell command runs\n\n## Verification Commands\n\n```bash\n# label: smoke\n# expect-stdout-contains: ok\nprintf 'ok\\n'\n```\n",
    "utf8",
  );

  return { repo, env };
}

describe("WIKI-FORGE-145 slice source_paths drift warning", () => {
  test("verify-slice warns when git history since started_at touches files missing from source_paths", () => {
    const { repo, env } = setupSliceFixture(false);

    const result = runWiki(["verify-slice", "wf145s", "WF145S-001", "--repo", repo, "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.warnings.some((warning: string) => warning.includes("src/new-helper.ts"))).toBe(true);
  });

  test("verify-slice stays quiet when every touched file is already declared in source_paths", () => {
    const { repo, env } = setupSliceFixture(true);

    const result = runWiki(["verify-slice", "wf145s", "WF145S-001", "--repo", repo, "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.warnings ?? []).toEqual([]);
  });
});
