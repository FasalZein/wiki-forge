import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setDependsOn(vault: string, project: string, taskId: string, deps: string[]) {
  const indexPath = join(vault, "projects", project, "specs", "slices", taskId, "index.md");
  const current = readFileSync(indexPath, "utf8");
  const injected = current.replace(`task_id: ${taskId}`, `task_id: ${taskId}\ndepends_on:\n${deps.map((dep) => `  - ${dep}`).join("\n")}`);
  writeFileSync(indexPath, injected, "utf8");
}

describe("wiki dependency graph", () => {
  test("writes a derived canvas from feature prd and slice metadata", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    setDependsOn(vault, "demo", "DEMO-002", ["DEMO-001"]);

    const result = runWiki(["dependency-graph", "demo", "--write", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.counts.nodes).toBe(4);
    expect(json.counts.edges).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(vault, "projects", "demo", "verification", "dependency-graph.canvas"))).toBe(true);
  });

  test("fails when slice dependencies form a cycle", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice"], env).exitCode).toBe(0);
    setDependsOn(vault, "demo", "DEMO-001", ["DEMO-002"]);
    setDependsOn(vault, "demo", "DEMO-002", ["DEMO-001"]);

    const result = runWiki(["dependency-graph", "demo", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.counts.cycles).toBe(1);
    expect(json.cycles[0].join(" -> ")).toContain("DEMO-001");
  });
});
