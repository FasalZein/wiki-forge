import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setDependsOn(vault: string, project: string, taskId: string, deps: string[]) {
  const indexPath = join(vault, "projects", project, "specs", "slices", taskId, "index.md");
  const current = readFileSync(indexPath, "utf8");
  const injected = current.replace("task_id: " + taskId, `task_id: ${taskId}\ndepends_on:\n${deps.map((dep) => `  - ${dep}`).join("\n")}`);
  writeFileSync(indexPath, injected, "utf8");
}

describe("wiki slice lifecycle", () => {
  test("move-task blocks in-progress transition when dependencies are unfinished", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice"], env).exitCode).toBe(0);
    setDependsOn(vault, "demo", "DEMO-002", ["DEMO-001"]);

    const result = runWiki(["move-task", "demo", "DEMO-002", "--to", "In Progress"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("blocked by unfinished dependencies");
  });

  test("next skips blocked slices and recommends the first ready dependency root", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice"], env).exitCode).toBe(0);
    setDependsOn(vault, "demo", "DEMO-002", ["DEMO-001"]);

    const result = runWiki(["next", "demo", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.recommendation.id).toBe("DEMO-001");
    expect(json.warnings.some((warning: string) => warning.includes("blocked by"))).toBe(true);
  });

  test("claim blocks slices whose dependencies are not done", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice"], env).exitCode).toBe(0);
    setDependsOn(vault, "demo", "DEMO-002", ["DEMO-001"]);

    const result = runWiki(["claim", "demo", "DEMO-002", "--json"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("blockedBy");
  });

  test("verify-slice runs test-plan commands and promotes the test plan", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    const testPlanPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md");
    writeFileSync(testPlanPath, "---\ntitle: DEMO-001 auth slice\ntype: spec\nspec_kind: test-plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# DEMO-001 auth slice\n\n## Verification Commands\n\n```bash\nbun test tests/other.test.ts\n```\n", "utf8");

    const result = runWiki(["verify-slice", "demo", "DEMO-001", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.commands[0].ok).toBe(true);
    expect(readFileSync(testPlanPath, "utf8")).toContain("verification_level: test-verified");
  });

  test("verify-slice returns failing command details", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    const testPlanPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md");
    writeFileSync(testPlanPath, "---\ntitle: DEMO-001 auth slice\ntype: spec\nspec_kind: test-plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# DEMO-001 auth slice\n\n## Verification Commands\n\n```bash\nbun test tests/missing.test.ts\n```\n", "utf8");

    const result = runWiki(["verify-slice", "demo", "DEMO-001", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.ok).toBe(false);
    expect(json.commands[0].ok).toBe(false);
  });

  test("backlog parser accepts both checked and unchecked checkboxes", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["complete-task", "demo", "DEMO-001"], env).exitCode).toBe(0);

    // Manually corrupt the backlog by changing `- [ ]` to `- [x]`
    const backlogPath = join(vault, "projects", "demo", "backlog.md");
    const content = readFileSync(backlogPath, "utf8");
    writeFileSync(backlogPath, content.replace("- [ ] **DEMO-001**", "- [x] **DEMO-001**"), "utf8");

    // Parser should still see the task
    const result = runWiki(["backlog", "demo", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    const doneItems = json.sections.Done ?? [];
    expect(doneItems.some((item: { id: string }) => item.id === "DEMO-001")).toBe(true);
  });

  test("backlog serialization normalizes checked checkboxes back to unchecked", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice"], env).exitCode).toBe(0);

    // Corrupt both with [x]
    const backlogPath = join(vault, "projects", "demo", "backlog.md");
    const content = readFileSync(backlogPath, "utf8");
    writeFileSync(backlogPath, content.replaceAll("- [ ] **DEMO-", "- [x] **DEMO-"), "utf8");

    // Moving a task triggers serialization which normalizes checkboxes
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);
    const after = readFileSync(backlogPath, "utf8");
    expect(after).not.toContain("- [x]");
    expect(after).toContain("- [ ] **DEMO-001**");
    expect(after).toContain("- [ ] **DEMO-002**");
  });
});
