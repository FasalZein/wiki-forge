import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupRepo(project: string) {
  const vault = tempDir(`${project}-vault`);
  const repo = tempDir(`${project}-repo`);
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", project], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, project);
  expect(runWiki(["create-issue-slice", project, "auth slice"], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("WIKI-FORGE-149 steering packet", () => {
  test("resume json includes shared steering for domain-work", () => {
    const { repo, env } = setupRepo("wf149resume");
    expect(runWiki(["forge", "start", "wf149resume", "WF149RESUME-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["resume", "wf149resume", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.phase).toBe("research");
    expect(payload.steering.loadSkill).toBe("/research");
  });

  test("forge status json keeps docs-ready but research-incomplete slice in domain-work", () => {
    const { vault, env } = setupRepo("wf149status");
    const sliceDir = join(vault, "projects", "wf149status", "specs", "slices", "WF149STATUS-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149STATUS-001\ntype: spec\nspec_kind: plan\nproject: wf149status\ntask_id: WF149STATUS-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149STATUS-001\ntype: spec\nspec_kind: test-plan\nproject: wf149status\ntask_id: WF149STATUS-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n",
      "utf8",
    );

    const result = runWiki(["forge", "status", "wf149status", "WF149STATUS-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.triage.kind).toBe("needs-research");
    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.phase).toBe("research");
    expect(payload.steering.loadSkill).toBe("/research");
    expect(payload.steering.nextCommand).not.toContain("wiki forge run wf149status WF149STATUS-001");
  });

  test("forge next text leads with the shared pre-implementation steering packet", () => {
    const { vault, env } = setupRepo("wf149next");
    const sliceDir = join(vault, "projects", "wf149next", "specs", "slices", "WF149NEXT-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149NEXT-001\ntype: spec\nspec_kind: plan\nproject: wf149next\ntask_id: WF149NEXT-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149NEXT-001\ntype: spec\nspec_kind: test-plan\nproject: wf149next\ntask_id: WF149NEXT-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n",
      "utf8",
    );

    const result = runWiki(["forge", "next", "wf149next"], env);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();

    expect(output).toContain("- lane: domain-work");
    expect(output).toContain("- load-skill: /research");
    expect(output).not.toContain("- next: wiki forge run wf149next WF149NEXT-001 --repo <path>");
  });

  test("forge next keeps placeholder-ready slices in the pre-implementation lane", () => {
    const { vault, env } = setupRepo("wf149placeholder");
    const sliceDir = join(vault, "projects", "wf149placeholder", "specs", "slices", "WF149PLACEHOLDER-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF149PLACEHOLDER-001\ntype: spec\nspec_kind: plan\nproject: wf149placeholder\ntask_id: WF149PLACEHOLDER-001\nupdated: 2026-04-19\nstatus: ready\n---\n\n# plan\n\n## Scope\n\n- PRD-001 placeholder slice\n\n## Vertical Slice\n\n1. (fill in during TDD)\n2. (fill in during TDD)\n3. (fill in during TDD)\n\n## Acceptance Criteria\n\n- [ ] implement requirements from PRD-001 placeholder slice\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF149PLACEHOLDER-001\ntype: spec\nspec_kind: test-plan\nproject: wf149placeholder\ntask_id: WF149PLACEHOLDER-001\nupdated: 2026-04-19\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [ ] implement requirements from PRD-001 placeholder slice\n\n## Green Criteria\n\n- [ ] All red tests pass\n- [ ] No regressions in existing test suite\n\n## Refactor Checks\n\n- [ ] confirm no regressions in adjacent code paths\n",
      "utf8",
    );

    const result = runWiki(["forge", "next", "wf149placeholder", "--json"], env);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());

    expect(payload.targetSlice).toBe("WF149PLACEHOLDER-001");
    expect(payload.planStatus).toBe("incomplete");
    expect(payload.testPlanStatus).toBe("incomplete");
    expect(payload.triage.kind).toBe("needs-research");
    expect(payload.steering.lane).toBe("domain-work");
    expect(payload.steering.nextCommand).not.toContain("wiki forge run wf149placeholder WF149PLACEHOLDER-001");
  });
});
