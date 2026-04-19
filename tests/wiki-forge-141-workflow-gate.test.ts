import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

// Helper: make a repo + vault with a project and one slice (no research,
// no decisions, no PRD body), so the workflow ledger's next phase is "research".
function setupPhaseResearchFixture() {
  const vault = tempDir("wf141-vault");
  const repo = tempDir("wf141-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf141"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf141");
  // One issue slice (no PRD, no research artifact, no decisions entry).
  expect(runWiki(["create-issue-slice", "wf141", "first slice"], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("WIKI-FORGE-141 workflow-phase gate", () => {
  test("F1: resume with workflow-next-phase=research surfaces a research-oriented command, not forge run", () => {
    const { vault, repo, env } = setupPhaseResearchFixture();

    // Auto-start the slice so it is active/in-progress.
    expect(runWiki(["forge", "start", "wf141", "WF141-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const resume = runWiki(["resume", "wf141", "--repo", repo, "--json"], env);
    expect(resume.exitCode).toBe(0);
    const payload = JSON.parse(resume.stdout.toString());

    // Sanity: resume correctly detected that the research phase is the next gate.
    expect(payload.workflowNextPhase).toBe("research");

    // F1 assertion: triage.command must NOT be a forge run for this active slice.
    expect(payload.triage.command).not.toContain("wiki forge run");
    // Triage reason should name the missing phase so the operator knows what to do.
    expect(payload.triage.reason.toLowerCase()).toContain("research");
    expect(payload.triage.loadSkill).toBe("/research");
  });

  test("F1 no-regression: resume with ready plan + test-plan still recommends forge run", () => {
    const { vault, repo, env } = setupPhaseResearchFixture();

    // Fill plan + test-plan so the slice is docs-ready (triage becomes close-slice/open-slice).
    const sliceDir = join(vault, "projects", "wf141", "specs", "slices", "WF141-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF141-001\ntype: spec\nspec_kind: plan\nproject: wf141\ntask_id: WF141-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# plan\n\n## Scope\n\n- ship it\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF141-001\ntype: spec\nspec_kind: test-plan\nproject: wf141\ntask_id: WF141-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n\n## Verification Commands\n\n```bash\n# label: tests\nbun test\n```\n",
      "utf8",
    );
    expect(runWiki(["forge", "start", "wf141", "WF141-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const resume = runWiki(["resume", "wf141", "--repo", repo, "--json"], env);
    expect(resume.exitCode).toBe(0);
    const payload = JSON.parse(resume.stdout.toString());
    // Docs-ready → triage recommends forge run (close-slice kind), not a needs-* command.
    expect(payload.triage.command).toContain("wiki forge run wf141 WF141-001");
  });

  test("F2: forge run on a workflow-not-implementation-ready slice fails fast without claiming it", () => {
    const { vault, repo, env } = setupPhaseResearchFixture();

    // Slice is in Todo, no research artifact — workflow next phase is "research".
    const run = runWiki(["forge", "run", "wf141", "WF141-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).not.toBe(0);
    const payload = JSON.parse(run.stdout.toString());
    expect(payload.ok).toBe(false);
    expect(payload.step).toBe("operator-lane");
    expect(payload.steering.phase).toBe("research");
    expect(payload.steering.lane).toBe("domain-work");

    // Slice must NOT have been claimed. No claimed_by, no started_at, no status=in-progress.
    const hubPath = join(vault, "projects", "wf141", "specs", "slices", "WF141-001", "index.md");
    const hub = readFileSync(hubPath, "utf8");
    expect(hub).not.toContain("claimed_by:");
    expect(hub).not.toContain("started_at:");
    expect(hub).toContain("status: draft");
  });

  test("F2 no-regression: forge run on a docs-ready slice is blocked by operator-lane instead of claiming and running closeout", () => {
    const { vault, repo, env } = setupPhaseResearchFixture();

    // Fill plan + test-plan so the slice is docs-ready. Triage becomes close-slice.
    const sliceDir = join(vault, "projects", "wf141", "specs", "slices", "WF141-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF141-001\ntype: spec\nspec_kind: plan\nproject: wf141\ntask_id: WF141-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# plan\n\n## Scope\n\n- ship it\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF141-001\ntype: spec\nspec_kind: test-plan\nproject: wf141\ntask_id: WF141-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n\n## Verification Commands\n\n```bash\n# label: tests\nbun test\n```\n",
      "utf8",
    );
    expect(runWiki(["forge", "start", "wf141", "WF141-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const run = runWiki(["forge", "run", "wf141", "WF141-001", "--repo", repo, "--json"], env);
    const stdout = run.stdout.toString();
    const payload = stdout ? JSON.parse(stdout) : { step: "" };
    expect(run.exitCode).toBe(1);
    expect(payload.step).toBe("operator-lane");
    expect(payload.steering.lane).toBe("implementation-work");
  });
});
