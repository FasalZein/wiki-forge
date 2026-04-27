import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki coordination commands", () => {
  test("next recommends the active slice", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["next", "demo", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.recommendation.id).toBe("DEMO-001");
    expect(json.recommendation.reason).toContain("active");
  });

  test("next surfaces shared steering for active pre-implementation slices", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "plan.md");
    const testPlanPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md");
    writeFileSync(
      planPath,
      "---\ntitle: demo plan\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nstatus: ready\nupdated: 2026-04-20\n---\n\n# Plan\n\n## Scope\n\n- auth slice\n\n## Vertical Slice\n\n1. wire shared steering\n\n## Acceptance Criteria\n\n- [ ] adopt shared steering\n",
      "utf8",
    );
    writeFileSync(
      testPlanPath,
      "---\ntitle: demo test plan\ntype: spec\nspec_kind: test-plan\nproject: demo\ntask_id: DEMO-001\nstatus: ready\nupdated: 2026-04-20\nverification_commands:\n  - command: bun test\n---\n\n# Test Plan\n\n## Red Tests\n\n- [ ] adopt shared steering\n\n## Green Criteria\n\n- [ ] All red tests pass\n",
      "utf8",
    );

    const result = runWiki(["next", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.recommendation.id).toBe("DEMO-001");
    expect(json.steering.lane).toBe("domain-work");
    expect(json.steering.loadSkill).toBe("/research");
    expect(json.steering.nextCommand).not.toContain("wiki forge run demo DEMO-001");
  });

  test("start-slice moves the slice to in-progress, stamps claim metadata, and returns a plan summary", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "plan.md"), "---\ntitle: DEMO-001 auth slice\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nsource_paths:\n  - src/auth.ts\nupdated: 2026-04-13\nstatus: current\n---\n\n# DEMO-001 auth slice\n\n## Scope\n\n- Split auth work into a smaller slice\n\n## Target Structure\n\n- src/auth.ts\n\n## Acceptance Criteria\n\n- start-slice returns a compact summary\n", "utf8");

    const result = runWiki(["start-slice", "demo", "DEMO-001", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.sliceId).toBe("DEMO-001");
    expect(json.status).toBe("in-progress");
    expect(json.agent).toBe("codex");
    expect(json.claimedPaths).toContain("src/auth.ts");
    expect(json.planSummary).toContain("Split auth work into a smaller slice");

    const backlog = JSON.parse(runWiki(["backlog", "demo", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"][0].id).toBe("DEMO-001");

    const hub = readFileSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md"), "utf8");
    expect(hub).toContain("status: in-progress");
    expect(hub).toContain("started_at:");
    expect(hub).toContain("claimed_by: codex");
  });

  test("start-slice blocks unmet dependencies with exit code 1", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    const secondHubPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-002", "index.md");
    writeFileSync(secondHubPath, readFileSync(secondHubPath, "utf8").replace("task_id: DEMO-002\n", "task_id: DEMO-002\ndepends_on:\n  - DEMO-001\n"), "utf8");

    const result = runWiki(["start-slice", "demo", "DEMO-002", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.dependencies[0].id).toBe("DEMO-001");
    expect(json.dependencies[0].status).toBe("todo");
    expect(result.stderr.toString()).toContain("blocked by unfinished dependencies");
  });

  test("start-slice does not treat docs-only done slices as canonically closed", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    const indexPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace("status: draft", "status: done\ncompleted_at: 2026-04-20T00:00:00.000Z"), "utf8");

    const result = runWiki(["start-slice", "demo", "DEMO-001", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.status).toBe("in-progress");
  });

  test("start-slice reports claim conflicts with exit code 2", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["start-slice", "demo", "DEMO-001", "--agent", "claude", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["start-slice", "demo", "DEMO-002", "--agent", "codex", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(2);
    const json = JSON.parse(result.stdout.toString());
    expect(json.conflicts[0].taskId).toBe("DEMO-001");
    expect(result.stderr.toString()).toContain("cannot start DEMO-002");
    expect(result.stderr.toString()).toContain("DEMO-001");
    expect(result.stderr.toString()).toContain("resolution:");
  });

  test("note records agent messages in the durable log", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const result = runWiki(["note", "demo", "left off at auth parser", "--agent", "scout", "--slice", "DEMO-001", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.agent).toBe("scout");
    expect(json.sliceId).toBe("DEMO-001");
    expect(readFileSync(join(vault, "log.md"), "utf8")).toContain("left off at auth parser");
  });

  test("claim reports overlapping in-progress slices", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/prds/PRD-001-auth-workflow.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "first slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "second slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["claim", "demo", "DEMO-002", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.ok).toBe(false);
    expect(json.conflicts[0].taskId).toBe("DEMO-001");
    expect(json.conflicts[0].overlap).toContain("src/auth.ts");
  });

  test("handover includes dirty git state and recent notes", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["note", "demo", "left off at parser", "--agent", "worker", "--slice", "DEMO-001"], env).exitCode).toBe(0);
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 3\n", "utf8");
    writeFileSync(join(repo, "src", "new.ts"), "export const n = 1\n", "utf8");

    const result = runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Updated the auth handoff and captured the parser stopping point.",
      "--blocker", "Parser follow-up is still pending.",
      "--json",
    ], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.focus.activeTask.id).toBe("DEMO-001");
    expect(json.dirty.modifiedFiles).toContain("src/auth.ts");
    expect(json.dirty.untrackedFiles).toContain("src/new.ts");
    expect(json.shortPrompt).toContain("Load /wiki and /forge.");
    expect(json.shortPrompt).toContain("wiki resume demo --repo");
    expect(json.shortPrompt).toContain("/research");
    expect(json.shortPrompt).not.toContain("wiki forge run demo DEMO-001");
    expect(Array.isArray(json.accomplishments)).toBe(true);
    expect(json.accomplishments).toContain("Updated the auth handoff and captured the parser stopping point.");
    expect(Array.isArray(json.blockers)).toBe(true);
    expect(json.blockers).toContain("Parser follow-up is still pending.");
    expect(json.recentNotes.some((entry: string) => entry.includes("left off at parser"))).toBe(true);
    // Verify handover file was written (WIKI-FORGE-073)
    expect(json.handoverPath).toContain("handovers/");
    const handoverDir = join(vault, "projects", "demo", "handovers");
    expect(existsSync(handoverDir)).toBe(true);
    const handoverFiles = readdirSync(handoverDir).filter((f: string) => f.endsWith(".md"));
    expect(handoverFiles.length).toBeGreaterThan(0);
    const handoverContent = readFileSync(join(handoverDir, handoverFiles[0]), "utf8");
    expect(handoverContent).toContain("type: handover");
    expect(handoverContent).toContain("project: demo");
    expect(handoverContent).toContain("status: current");
    expect(handoverContent).toContain("## Short Prompt");
    expect(handoverContent).toContain("## Session Summary");
    expect(handoverContent).toContain("## Recent Commits");
    expect(handoverContent).toContain("## Dirty State");
    expect(handoverContent).toContain("## Next Session Priorities");
    expect(handoverContent).toContain("## Tracked Artifacts");
    expect(handoverContent).toContain("## What Was Accomplished");
    expect(handoverContent).toContain("## Blockers & Open Questions");
    expect(handoverContent).toContain("```text");
    expect(handoverContent).toContain("Load /wiki and /forge.");
    expect(handoverContent).toContain("[[projects/demo/specs/slices/DEMO-001/index|DEMO-001 auth slice]]");
    expect(handoverContent).toContain("[[projects/demo/specs/slices/DEMO-001/plan|DEMO-001 plan]]");
    expect(handoverContent).toContain("[[projects/demo/specs/slices/DEMO-001/test-plan|DEMO-001 test plan]]");
    expect(handoverContent).toContain("Updated the auth handoff and captured the parser stopping point.");
    expect(handoverContent).toContain("Parser follow-up is still pending.");
    expect(handoverContent).not.toContain("<!-- LLM: fill in what was accomplished during this session -->");
    expect(handoverContent).not.toContain("<!-- LLM: fill in any blockers or open questions -->");
    // WIKI-FORGE-101: agent-alignment callout + priorities precede auto sections
    expect(handoverContent).toContain("> [!note] Agent alignment");
    const shortPromptIdx = handoverContent.indexOf("## Short Prompt");
    const priorityIdx = handoverContent.indexOf("## Next Session Priorities");
    const artifactsIdx = handoverContent.indexOf("## Tracked Artifacts");
    const summaryIdx = handoverContent.indexOf("## Session Summary");
    expect(shortPromptIdx).toBeGreaterThan(0);
    expect(priorityIdx).toBeGreaterThan(shortPromptIdx);
    expect(priorityIdx).toBeGreaterThan(0);
    expect(artifactsIdx).toBeGreaterThan(priorityIdx);
    expect(summaryIdx).toBeGreaterThan(artifactsIdx);
  });

  test("handover short prompt uses steering when the next slice is still in pre-implementation phases", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "auth slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "plan.md");
    const testPlanPath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "test-plan.md");
    writeFileSync(
      planPath,
      "---\ntitle: demo plan\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nstatus: ready\nupdated: 2026-04-20\n---\n\n# Plan\n\n## Scope\n\n- auth slice\n\n## Vertical Slice\n\n1. (fill in during TDD)\n2. (fill in during TDD)\n3. (fill in during TDD)\n\n## Acceptance Criteria\n\n- [ ] implement requirements from PRD-001 auth slice\n",
      "utf8",
    );
    writeFileSync(
      testPlanPath,
      "---\ntitle: demo test plan\ntype: spec\nspec_kind: test-plan\nproject: demo\ntask_id: DEMO-001\nstatus: ready\nupdated: 2026-04-20\nverification_commands:\n  - command: bun test\n---\n\n# Test Plan\n\n## Red Tests\n\n- [ ] implement requirements from PRD-001 auth slice\n\n## Green Criteria\n\n- [ ] All red tests pass\n- [ ] No regressions in existing test suite\n\n## Refactor Checks\n\n- [ ] confirm no regressions in adjacent code paths\n",
      "utf8",
    );

    const result = runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Captured the research gap for the auth slice.",
      "--no-blockers",
      "--json",
      "--no-write",
    ], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.steering.lane).toBe("domain-work");
    expect(json.shortPrompt).toContain("/research");
    expect(json.shortPrompt).not.toContain("wiki forge run demo DEMO-001");
  });

  test("handover defaults to complete auto-only context and keeps the explicit escape hatch", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const defaultAuto = runWiki(["handover", "demo", "--repo", repo, "--base", "HEAD~1", "--json", "--no-write"], env);
    expect(defaultAuto.exitCode).toBe(0);
    const defaultJson = JSON.parse(defaultAuto.stdout.toString());
    expect(defaultJson.handoverMode).toBe("auto-only");
    expect(Array.isArray(defaultJson.accomplishments)).toBe(true);
    expect(Array.isArray(defaultJson.blockers)).toBe(true);

    const autoOnly = runWiki(["handover", "demo", "--repo", repo, "--base", "HEAD~1", "--allow-auto-only", "--json", "--no-write"], env);
    expect(autoOnly.exitCode).toBe(0);
    const json = JSON.parse(autoOnly.stdout.toString());
    expect(json.handoverMode).toBe("auto-only");
    expect(Array.isArray(json.accomplishments)).toBe(true);
    expect(Array.isArray(json.blockers)).toBe(true);
  });

  test("handover falls back to recommended task artifacts when no slice is active", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-feature", "demo", "workflow handoff"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "workflow handoff"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const result = runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Queued the next slice and recorded the lineage artifacts.",
      "--no-blockers",
      "--json",
    ], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    const handoverPath = join(vault, json.handoverPath);
    const handoverContent = readFileSync(handoverPath, "utf8");

    expect(handoverContent).toContain("- Recommended Slice:");
    expect(handoverContent).toContain("[[projects/demo/specs/features/FEAT-001-workflow-handoff|FEAT-001 workflow handoff]]");
    expect(handoverContent).toContain("[[projects/demo/specs/prds/PRD-001-workflow-handoff|PRD-001 workflow handoff]]");
    expect(handoverContent).toContain("[[projects/demo/specs/slices/DEMO-001/index|DEMO-001 auth slice]]");
    expect(handoverContent).toContain("[[projects/demo/specs/slices/DEMO-001/plan|DEMO-001 plan]]");
    expect(handoverContent).toContain("[[projects/demo/specs/slices/DEMO-001/test-plan|DEMO-001 test plan]]");
  });

  test("handover stdout survives tail -N: pointer at top, prompt at end, path as last line", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Prepared the next session handoff.",
      "--no-blockers",
    ], env);
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    const lines = stdout.split("\n");
    const nonEmpty = lines.filter((l) => l.trim().length > 0);

    // Top pointer: within the first few non-empty lines, there must be a pointer
    // naming the prompt's end location so `| head -N` users still know how to recover.
    const topBlock = nonEmpty.slice(0, 5).join("\n");
    expect(topBlock).toContain("NEXT SESSION PROMPT");

    // Prompt block must appear AFTER session context (so `| tail -N` keeps it).
    const contextIdx = stdout.indexOf("--- session context ---");
    const promptIdx = stdout.indexOf("--- next session prompt ---");
    expect(contextIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeGreaterThan(contextIdx);

    // Prompt block is printed exactly once.
    const promptCount = (stdout.match(/--- next session prompt ---/g) || []).length; // desloppify:ignore EMPTY_ARRAY_FALLBACK
    expect(promptCount).toBe(1);

    // Last non-empty line is the handover file path — so even aggressive truncation
    // leaves an actionable recovery hint (`cat <that path>`).
    const lastLine = nonEmpty[nonEmpty.length - 1];
    expect(lastLine).toMatch(/^handover written: /);
    expect(lastLine).toContain("handovers/");
  });

  test("handover with --no-write does not create a file", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Kept the handover ephemeral for this test.",
      "--no-blockers",
      "--json",
      "--no-write",
    ], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.handoverPath).toBeUndefined();
    expect(existsSync(join(vault, "projects", "demo", "handovers"))).toBe(false);
  });

  test("handover with --harness sets harness in frontmatter", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Tagged the handover with a harness.",
      "--no-blockers",
      "--json",
      "--harness", "claude-code",
    ], env);
    expect(result.exitCode).toBe(0);
    const handoverDir = join(vault, "projects", "demo", "handovers");
    const handoverFiles = readdirSync(handoverDir).filter((f: string) => f.endsWith(".md"));
    const content = readFileSync(join(handoverDir, handoverFiles[0]), "utf8");
    expect(content).toContain("harness: claude-code");
  });

  test("resume surfaces latest handover metadata", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-feature", "demo", "workflow handoff"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "workflow handoff"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    // First create a handover
    expect(runWiki([
      "handover",
      "demo",
      "--repo", repo,
      "--base", "HEAD~1",
      "--accomplished", "Captured the handover metadata for the next run.",
      "--blocker", "Resume should surface this authored blocker.",
      "--harness", "test-harness",
    ], env).exitCode).toBe(0);

    // Then resume should detect it
    const result = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(typeof json.lastHandover).toBe("object");
    expect(json.lastHandover.harness).toBe("test-harness");
    expect(json.lastHandover.path).toContain("handovers/");
    expect(json.lastHandover.accomplishments).toContain("Captured the handover metadata for the next run.");
    expect(json.lastHandover.blockers).toContain("Resume should surface this authored blocker.");
    expect(json.lastHandover.trackedArtifacts).toContain("Recommended Slice");
    expect(json.lastHandover.trackedArtifacts).toContain("[[projects/demo/specs/slices/DEMO-001/plan|DEMO-001 plan]]");

    const text = runWiki(["resume", "demo", "--repo", repo, "--base", "HEAD~1"], env);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("- handover accomplishments:");
    expect(text.stdout.toString()).toContain("Captured the handover metadata for the next run.");
    expect(text.stdout.toString()).toContain("- handover blockers:");
    expect(text.stdout.toString()).toContain("Resume should surface this authored blocker.");
    expect(text.stdout.toString()).toContain("- tracked artifacts:");
    expect(text.stdout.toString()).toContain("[[projects/demo/specs/prds/PRD-001-workflow-handoff|PRD-001 workflow handoff]]");
  });

  test("close-slice moves a passing slice to done", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(true);

    const backlog = runWiki(["backlog", "gated", "--json"], env);
    const backlogJson = JSON.parse(backlog.stdout.toString());
    expect(backlogJson.sections.Done[0].id).toBe("GATED-001");
  });

  test("close-slice --slice-local ignores parent drift warnings", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-feature", "gated", "Payments"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "gated", "--feature", "FEAT-001", "Payments"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "gated", "payments slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    const featurePath = join(vault, "projects", "gated", "specs", "features", "FEAT-001-payments.md");
    const prdPath = join(vault, "projects", "gated", "specs", "prds", "PRD-001-payments.md");
    writeFileSync(featurePath, readFileSync(featurePath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(prdPath, readFileSync(prdPath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--worktree", "--slice-local", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(true);
  });

  test("close-slice auto-heals backlog drift from canonical slice state", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "index.md"), readFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "index.md"), "utf8").replace("status: draft", "status: in-progress\nstarted_at: 2026-04-17T00:00:00.000Z"), "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\n# label: payments tests\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(true);

    const backlog = JSON.parse(runWiki(["backlog", "gated", "--json"], env).stdout.toString());
    expect(backlog.sections.Done[0].id).toBe("GATED-001");
  });

  test("close-slice blocks when verified code changes again in the worktree", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-slice", "gated", "GATED-001", "--repo", repo], env).exitCode).toBe(0);

    writeFileSync(join(repo, "src", "payments.ts"), "export const total = 3\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "import { expect, test } from 'bun:test'\nimport { total } from '../src/payments'\ntest('total', () => expect(total).toBe(3))\n", "utf8");

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout.toString());
    expect(json.closed).toBe(false);
    expect(json.blockers.some((blocker: string) => blocker.includes("impacted page"))).toBe(true);
  });

  test("close-slice requires a test-verified test plan", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("test-plan.md verification_level is");
  });

  test("close-slice requires structured verification evidence", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "gated");
    expect(runWiki(["create-issue-slice", "gated", "payments slice"], env).exitCode).toBe(0);
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Scope\n\n- Ship the payments change\n", "utf8");
    writeFileSync(join(vault, "projects", "gated", "specs", "slices", "GATED-001", "test-plan.md"), "---\ntitle: GATED-001 payments slice\ntype: spec\nspec_kind: test-plan\nproject: gated\ntask_id: GATED-001\nupdated: 2026-04-13\nstatus: current\n---\n\n# GATED-001 payments slice\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n", "utf8");
    expect(runWiki(["bind", "gated", "specs/slices/GATED-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "gated", "GATED-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "gated", "specs/slices/GATED-001/test-plan.md", "test-verified"], env).exitCode).toBe(0);

    const result = runWiki(["close-slice", "gated", "GATED-001", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("missing structured verification evidence");
  });
});
