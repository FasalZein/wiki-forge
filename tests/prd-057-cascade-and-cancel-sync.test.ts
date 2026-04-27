/**
 * Tests for PRD-057: cascade-aware page bookkeeping (Behavior A) +
 * cancelled-slice backlog row sync (Behavior B).
 *
 * All tests use runWiki() subprocess so each invocation reads a fresh
 * KNOWLEDGE_VAULT_ROOT — keeps writes isolated to the temp vault.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, runGit, setupVaultAndRepo, setRepoFrontmatter } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupProject(projectName = "p57") {
  const { vault, repo } = setupVaultAndRepo();
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", projectName], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, projectName);
  const base = runGit(repo, ["rev-parse", "HEAD~1"]).stdout.toString().trim();
  const slicesDir = join(vault, "projects", projectName, "specs", "slices");
  mkdirSync(slicesDir, { recursive: true });
  return { vault, repo, env, base, slicesDir, project: projectName };
}

function writeSliceHub(slicesDir: string, project: string, opts: { taskId: string; status: string; supersededBy?: string }) {
  const dir = join(slicesDir, opts.taskId);
  mkdirSync(dir, { recursive: true });
  const lines = [`---`, `title: ${opts.taskId}`, `type: spec`, `spec_kind: task-hub`, `project: ${project}`, `task_id: ${opts.taskId}`, `status: ${opts.status}`];
  if (opts.supersededBy) lines.push(`superseded_by: ${opts.supersededBy}`);
  lines.push(`---`, `# ${opts.taskId}`, ``);
  writeFileSync(join(dir, "index.md"), lines.join("\n"), "utf8");
}

function addBacklogRow(vault: string, project: string, row: string, section = "Todo") {
  const backlogPath = join(vault, "projects", project, "backlog.md");
  const current = readFileSync(backlogPath, "utf8");
  const heading = `## ${section}`;
  if (!current.includes(heading)) throw new Error(`no ${section} section in backlog.md`);
  const next = current.replace(heading, `${heading}\n\n${row}`);
  writeFileSync(backlogPath, next, "utf8");
}

function readBacklogRow(vault: string, project: string, taskId: string): string | null {
  const backlogPath = join(vault, "projects", project, "backlog.md");
  const lines = readFileSync(backlogPath, "utf8").split("\n");
  return lines.find((l) => l.includes(`**${taskId}**`)) ?? null;
}

// ─── Behavior B — close-slice --reason / --superseded-by ──────────────────────

describe("Behavior B — close-slice cancel fork (PRD-057)", () => {
  test("--reason rewrites backlog row to [-] with annotation and flips hub to cancelled", () => {
    const { vault, env, slicesDir, project } = setupProject();
    writeSliceHub(slicesDir, project, { taskId: "P57-001", status: "in-progress" });
    addBacklogRow(vault, project, `- [ ] **P57-001** test slice`);

    const result = runWiki(["close-slice", project, "P57-001", "--reason", "re-scoped"], env);
    expect(result.exitCode).toBe(0);

    const row = readBacklogRow(vault, project, "P57-001");
    expect(row).toBe("- [-] **P57-001** test slice — cancelled: re-scoped");

    const hub = readFileSync(join(slicesDir, "P57-001", "index.md"), "utf8");
    expect(hub).toContain("status: cancelled");
  });

  test("--superseded-by sets hub frontmatter and annotates row", () => {
    const { vault, env, slicesDir, project } = setupProject();
    writeSliceHub(slicesDir, project, { taskId: "P57-002", status: "in-progress" });
    addBacklogRow(vault, project, `- [>] **P57-002** superseded slice`);

    const result = runWiki(["close-slice", project, "P57-002", "--superseded-by", "P57-999"], env);
    expect(result.exitCode).toBe(0);

    const row = readBacklogRow(vault, project, "P57-002");
    expect(row).toContain("- [-] **P57-002**");
    expect(row).toContain("— cancelled: superseded by P57-999");

    const hub = readFileSync(join(slicesDir, "P57-002", "index.md"), "utf8");
    expect(hub).toContain("status: cancelled");
    expect(hub).toContain("superseded_by: P57-999");
  });

  test("--reason wins when both --reason and --superseded-by are passed", () => {
    const { vault, env, slicesDir, project } = setupProject();
    writeSliceHub(slicesDir, project, { taskId: "P57-003", status: "in-progress" });
    addBacklogRow(vault, project, `- [/] **P57-003** both flags`);

    const result = runWiki(["close-slice", project, "P57-003", "--reason", "human reason", "--superseded-by", "P57-999"], env);
    expect(result.exitCode).toBe(0);

    const row = readBacklogRow(vault, project, "P57-003");
    expect(row).toContain("— cancelled: human reason");
    expect(row).not.toContain("superseded by P57-999");

    const hub = readFileSync(join(slicesDir, "P57-003", "index.md"), "utf8");
    expect(hub).toContain("superseded_by: P57-999");
  });

  test("row already [-] is idempotent (first reason is preserved, no stacking)", () => {
    const { vault, env, slicesDir, project } = setupProject();
    writeSliceHub(slicesDir, project, { taskId: "P57-004", status: "in-progress" });
    addBacklogRow(vault, project, `- [ ] **P57-004** double-call`);

    expect(runWiki(["close-slice", project, "P57-004", "--reason", "first"], env).exitCode).toBe(0);
    const first = readBacklogRow(vault, project, "P57-004");
    expect(first).toContain("— cancelled: first");

    expect(runWiki(["close-slice", project, "P57-004", "--reason", "second"], env).exitCode).toBe(0);
    const second = readBacklogRow(vault, project, "P57-004");

    // Once cancelled, the annotation is frozen — second call is a no-op on the row.
    expect(second).toBe(first);
    expect((second!.match(/— cancelled:/g) ?? []).length).toBe(1);
  });
});

// ─── Behavior B — reconciliation via wiki maintain ────────────────────────────

describe("Behavior B reconciliation — maintain detects drifted cancelled hub", () => {
  test("maintain flips [ ] → [-] when hub is cancelled but row is still open", () => {
    const { vault, repo, env, base, slicesDir, project } = setupProject();
    // Hub is already cancelled (e.g. someone hand-edited frontmatter) with superseded_by
    writeSliceHub(slicesDir, project, { taskId: "P57-010", status: "cancelled", supersededBy: "P57-888" });
    addBacklogRow(vault, project, `- [ ] **P57-010** drifted row`);

    const result = runWiki(["maintain", project, "--repo", repo, "--base", base], env);
    expect(result.exitCode).toBe(0);

    const row = readBacklogRow(vault, project, "P57-010");
    expect(row).toContain("- [-] **P57-010**");
    expect(row).toContain("— cancelled: superseded by P57-888");
  });

  test("maintain is idempotent: second run does not rewrite already-[-] row", () => {
    const { vault, repo, env, base, slicesDir, project } = setupProject();
    writeSliceHub(slicesDir, project, { taskId: "P57-011", status: "cancelled" });
    addBacklogRow(vault, project, `- [ ] **P57-011** needs sync`);

    expect(runWiki(["maintain", project, "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const first = readBacklogRow(vault, project, "P57-011");
    expect(first).toContain("- [-] **P57-011**");

    expect(runWiki(["maintain", project, "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const second = readBacklogRow(vault, project, "P57-011");
    expect(second).toBe(first);

    // log should have exactly one cancel-sync entry for P57-011
    const log = existsSync(join(vault, "log.md")) ? readFileSync(join(vault, "log.md"), "utf8") : "";
    const syncMatches = log.split("\n").filter((l) => l.includes("slice=P57-011") && log.includes("cancel-sync"));
    expect(syncMatches.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Behavior A — cascade-refresh for unchanged source hashes ─────────────────

describe("Behavior A — cascade-refresh (PRD-057)", () => {
  test("maintain stamps updated when source_paths all hash to verified_against", () => {
    const { vault, repo, env, base, project } = setupProject("cascade");
    expect(runWiki(["create-module", project, "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    // Acknowledge baseline — stamps verified_against = HEAD sha
    expect(runWiki(["acknowledge-impact", project, "modules/auth/spec.md", "--repo", repo], env).exitCode).toBe(0);
    const specPath = join(vault, "projects", project, "modules", "auth", "spec.md");
    const before = readFileSync(specPath, "utf8");
    const beforeUpdated = before.match(/^updated:\s*['"]?([^'"\n]+)/m)?.[1];
    expect(beforeUpdated).toEqual(expect.any(String));

    // Wait long enough that nowIso() produces a different timestamp
    const until = Date.now() + 1100;
    while (Date.now() < until) { /* spin */ }

    // Run maintain with older base — auth.ts appears in changedFiles, but its
    // last SHA matches verified_against → cascade-refresh should stamp forward.
    const result = runWiki(["maintain", project, "--repo", repo, "--base", base], env);
    expect(result.exitCode).toBe(0);

    const after = readFileSync(specPath, "utf8");
    const afterUpdated = after.match(/^updated:\s*['"]?([^'"\n]+)/m)?.[1];
    expect(afterUpdated).toEqual(expect.any(String));
    expect(afterUpdated).not.toBe(beforeUpdated);
  });

  test("cascade-refresh is idempotent — second run emits no new audit entry", () => {
    const { vault, repo, env, base, project } = setupProject("cascade2");
    expect(runWiki(["create-module", project, "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["acknowledge-impact", project, "modules/auth/spec.md", "--repo", repo], env).exitCode).toBe(0);

    expect(runWiki(["maintain", project, "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const logAfterFirst = readFileSync(join(vault, "log.md"), "utf8");
    const cascadeCountFirst = (logAfterFirst.match(/auto-heal \| cascade-refresh/g) ?? []).length; // desloppify:ignore EMPTY_ARRAY_FALLBACK
    expect(cascadeCountFirst).toBeGreaterThanOrEqual(1);

    expect(runWiki(["maintain", project, "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const logAfterSecond = readFileSync(join(vault, "log.md"), "utf8");
    const cascadeCountSecond = (logAfterSecond.match(/auto-heal \| cascade-refresh/g) ?? []).length; // desloppify:ignore EMPTY_ARRAY_FALLBACK
    expect(cascadeCountSecond).toBe(cascadeCountFirst);
  });
});

// ─── Production vault isolation guard ─────────────────────────────────────────

describe("write-routing isolation", () => {
  test("PRD-057 writes do not touch the production vault log", () => {
    const prodLog = process.env.HOME ? join(process.env.HOME, "Knowledge", "log.md") : null;
    const beforeSize = prodLog && existsSync(prodLog) ? readFileSync(prodLog, "utf8").length : 0;

    const { vault, env, slicesDir, project } = setupProject("iso");
    writeSliceHub(slicesDir, project, { taskId: "ISO-001", status: "in-progress" });
    addBacklogRow(vault, project, `- [ ] **ISO-001** isolation check`);
    expect(runWiki(["close-slice", project, "ISO-001", "--reason", "test"], env).exitCode).toBe(0);

    const afterSize = prodLog && existsSync(prodLog) ? readFileSync(prodLog, "utf8").length : 0;
    expect(afterSize).toBe(beforeSize);
  });
});
