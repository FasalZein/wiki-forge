import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupPassingRepo() {
  const vault = tempDir("wiki-vault");
  const repo = tempDir("wiki-repo-pass");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 1\n", "utf8");
  writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(1))\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "payments.ts"), "export const total = 2\n", "utf8");
  writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(2))\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  return { vault, repo };
}

describe("backlog projection from slice docs", () => {
  test("projects a done slice into Done even when backlog text is stale", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace("status: draft", "status: done\ncompleted_at: 2026-04-17T00:00:00.000Z"), "utf8");

    const backlog = runWiki(["backlog", "demo", "--json"], env);
    expect(backlog.exitCode).toBe(0);
    const json = JSON.parse(backlog.stdout.toString());
    expect(json.sections.Done[0].id).toBe("DEMO-001");
    expect((json.sections.Todo ?? []).some((item: { id: string }) => item.id === "DEMO-001")).toBe(false);
  });

  test("projects a reopened slice out of Done and back into In Progress", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "Done"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    const raw = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, raw.replace("status: draft", "status: in-progress\nstarted_at: 2026-04-17T00:00:00.000Z"), "utf8");

    const backlog = runWiki(["backlog", "demo", "--json"], env);
    expect(backlog.exitCode).toBe(0);
    const json = JSON.parse(backlog.stdout.toString());
    expect(json.sections["In Progress"][0].id).toBe("DEMO-001");
    expect((json.sections.Done ?? []).some((item: { id: string }) => item.id === "DEMO-001")).toBe(false);
  });

  test("projects a cancelled slice into Cancelled and removes it from forge next", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["close-slice", "demo", "DEMO-001", "--superseded-by", "DEMO-999"], env).exitCode).toBe(0);

    const backlog = runWiki(["backlog", "demo", "--json"], env);
    expect(backlog.exitCode).toBe(0);
    const json = JSON.parse(backlog.stdout.toString());
    expect(json.sections.Cancelled[0].id).toBe("DEMO-001");
    expect((json.sections.Todo ?? []).some((item: { id: string }) => item.id === "DEMO-001")).toBe(false);

    const next = runWiki(["forge", "next", "demo", "--json"], env);
    expect(next.exitCode).toBe(0);
    const nextJson = JSON.parse(next.stdout.toString());
    expect(nextJson.targetSlice).toBeNull();
    expect(nextJson.action).toBe("no ready slices");
  });

  test("next treats slice docs as the active lifecycle source even when backlog text was not moved", () => {
    const { vault } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);

    const sliceDir = join(vault, "projects", "gated", "specs", "slices", "GATED-001");
    writeFileSync(join(sliceDir, "index.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: task-hub\nproject: gated\ntask_id: GATED-001\nstatus: in-progress\nstarted_at: 2026-04-17T00:00:00.000Z\n---\n\n# GATED-001 payments slice\n", "utf8");

    const result = runWiki(["next", "gated", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.recommendation.id).toBe("GATED-001");
    expect(json.recommendation.reason).toContain("active");
  });
});
