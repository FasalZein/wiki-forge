import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentSim } from "./agent-sim";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function seedReadySlice(vault: string, project: string, sliceId: string) {
  const planPath = join(vault, "projects", project, "specs", "slices", sliceId, "plan.md");
  const testPlanPath = join(vault, "projects", project, "specs", "slices", sliceId, "test-plan.md");
  writeFileSync(
    planPath,
    [
      "---",
      `title: ${sliceId} payments slice`,
      "type: spec",
      "spec_kind: plan",
      `project: ${project}`,
      `task_id: ${sliceId}`,
      "updated: 2026-04-18",
      "status: current",
      "---",
      "",
      `# ${sliceId} payments slice`,
      "",
      "## Scope",
      "",
      "- Ship the payments change",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    testPlanPath,
    [
      "---",
      `title: ${sliceId} payments slice`,
      "type: spec",
      "spec_kind: test-plan",
      `project: ${project}`,
      `task_id: ${sliceId}`,
      "updated: 2026-04-18",
      "status: current",
      "verification_level: test-verified",
      "---",
      "",
      `# ${sliceId} payments slice`,
      "",
      "## Red Tests",
      "",
      "- [x] Payments behavior is covered through the public API.",
      "",
      "## Verification Commands",
      "",
      "```bash",
      "# label: payments tests",
      "bun test tests/payments.test.ts",
      "```",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("agent-driven simulator follows triage to terminal state", () => {
  test("drives a ready slice from todo to closed using only 'wiki resume' triage", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "simproj"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "simproj");
    expect(runWiki(["create-issue-slice", "simproj", "payments slice"], env).exitCode).toBe(0);
    seedReadySlice(vault, "simproj", "SIMPROJ-001");
    expect(runWiki(["bind", "simproj", "specs/slices/SIMPROJ-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    const result = runAgentSim("simproj", repo, "HEAD~1", env, { stepBudget: 8 });

    expect(result.converged, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.every((s) => s.exitCode === 0)).toBe(true);

    const backlog = JSON.parse(runWiki(["backlog", "simproj", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("SIMPROJ-001");

    const indexPath = join(vault, "projects", "simproj", "specs", "slices", "SIMPROJ-001", "index.md");
    expect(readFileSync(indexPath, "utf8")).toContain("status: done");
  });

  test("simulator recovers when an intermediate forge run fails due to bad verification command", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "recov"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "recov");
    expect(runWiki(["create-issue-slice", "recov", "payments slice"], env).exitCode).toBe(0);

    const testPlanPath = join(vault, "projects", "recov", "specs", "slices", "RECOV-001", "test-plan.md");
    writeFileSync(
      testPlanPath,
      [
        "---",
        "title: RECOV-001 payments slice",
        "type: spec",
        "spec_kind: test-plan",
        "project: recov",
        "task_id: RECOV-001",
        "updated: 2026-04-18",
        "status: current",
        "verification_level: test-verified",
        "---",
        "",
        "# RECOV-001 payments slice",
        "",
        "## Red Tests",
        "",
        "- [x] Broken command fixture.",
        "",
        "## Verification Commands",
        "",
        "```bash",
        "# label: broken command",
        "false",
        "```",
        "",
      ].join("\n"),
      "utf8",
    );
    const planPath = join(vault, "projects", "recov", "specs", "slices", "RECOV-001", "plan.md");
    writeFileSync(
      planPath,
      [
        "---",
        "title: RECOV-001 payments slice",
        "type: spec",
        "spec_kind: plan",
        "project: recov",
        "task_id: RECOV-001",
        "updated: 2026-04-18",
        "status: current",
        "---",
        "",
        "# RECOV-001 payments slice",
        "",
        "## Scope",
        "",
        "- Ship the payments change",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(runWiki(["bind", "recov", "specs/slices/RECOV-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);

    const failed = runAgentSim("recov", repo, "HEAD~1", env, { stepBudget: 4 });
    expect(failed.converged).toBe(false);
    expect(failed.steps.some((s) => s.exitCode !== 0)).toBe(true);

    const lastStep = failed.steps.at(-1);
    expect(lastStep).toBeDefined();
    const observedTriages = failed.steps.map((s) => s.triage);
    expect(
      observedTriages.every((kind) => kind !== "completed"),
      `should not converge on a broken slice, saw: ${observedTriages.join(",")}`,
    ).toBe(true);
  });
});
