import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupSliceLocalFixture() {
  const vault = tempDir("wf146-vault");
  const repo = tempDir("wf146-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  writeFileSync(join(repo, "src", "billing.ts"), "export const billing = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "billing.ts"), "export const billing = 2\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  const oldTime = new Date("2000-01-01T00:00:00Z");
  utimesSync(join(repo, "src", "auth.ts"), oldTime, oldTime);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf146"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf146");
  expect(runWiki(["create-issue-slice", "wf146", "slice local parity", "--source", "src/auth.ts"], env).exitCode).toBe(0);

  const pagesDir = join(vault, "projects", "wf146", "architecture");
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(
    join(pagesDir, "src-layout.md"),
    "---\ntitle: src layout\ntype: notes\nproject: wf146\nsource_paths:\n  - src/auth.ts\n  - src/billing.ts\nupdated: '2010-01-01T00:00:00.000Z'\nstatus: current\nverification_level: code-verified\n---\n# src layout\n",
    "utf8",
  );

  const sliceDir = join(vault, "projects", "wf146", "specs", "slices", "WF146-001");
  writeFileSync(
    join(sliceDir, "plan.md"),
    "---\ntitle: WF146-001\ntype: spec\nspec_kind: plan\nproject: wf146\ntask_id: WF146-001\nupdated: 2026-04-18\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- keep checkpoint slice-local\n",
    "utf8",
  );
  writeFileSync(
    join(sliceDir, "test-plan.md"),
    "---\ntitle: WF146-001\ntype: spec\nspec_kind: test-plan\nproject: wf146\ntask_id: WF146-001\nupdated: 2026-04-18\nstatus: ready\nverification_commands:\n  - command: printf 'ok\\n'\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] parity fixture\n\n## Verification Commands\n\n```bash\n# label: smoke\n# expect-stdout-contains: ok\nprintf 'ok\\n'\n```\n",
    "utf8",
  );

  return { repo, env };
}

describe("WIKI-FORGE-146 forge check slice-local parity", () => {
  test("forge check reports exact outside-slice ownership blockers", () => {
    const { repo, env } = setupSliceLocalFixture();

    const check = runWiki(["forge", "check", "wf146", "WF146-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(check.exitCode).not.toBe(0);
    const checkPayload = JSON.parse(check.stdout.toString());
    expect(checkPayload.pipeline.ok).toBe(true);
    expect(checkPayload.review.ok).toBe(false);
    expect(JSON.stringify(checkPayload.review.findings)).toContain("src/billing.ts");
  });

  test("forge check labels review blockers as overall failure even when pipeline passes", () => {
    const { repo, env } = setupSliceLocalFixture();
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
    runGit(repo, ["add", "src/auth.ts"]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "change auth without tests"]);
    const oldTime = new Date("2000-01-01T00:00:00Z");
    utimesSync(join(repo, "src", "auth.ts"), oldTime, oldTime);

    const check = runWiki(["forge", "check", "wf146", "WF146-001", "--repo", repo, "--base", "HEAD~1"], env);
    const output = check.stdout.toString() + check.stderr.toString();

    expect(check.exitCode).not.toBe(0);
    expect(output).toContain("forge check wf146/WF146-001: FAIL");
    expect(output).toContain("- pipeline: PASS");
    expect(output).toContain("- review gate: FAIL");
    expect(output).toContain("- overall: FAIL");
    expect(output).toContain("src/auth.ts");
    expect(output).not.toContain("forge check wf146/WF146-001: PASS");
  });

  test("non-slice-local checkpoint still reports broad-binding noise", () => {
    const { repo, env } = setupSliceLocalFixture();

    const checkpoint = runWiki(["checkpoint", "wf146", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(checkpoint.exitCode).toBe(1);
    const payload = JSON.parse(checkpoint.stdout.toString());
    expect(payload.stalePages.some((page: { page: string }) => page.page === "architecture/src-layout.md")).toBe(true);
  });
});
