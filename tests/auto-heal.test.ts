/**
 * Tests for PRD-055: auto-resolve parent status drift and persist computed_status.
 * Rules: R1 (computed_status persistence), R2 (parent reopen), R3 (cancel-cascade),
 * R4 (escalate on ambiguity), and transparency fix (forge.ts blocker detail lines).
 *
 * All tests use runWiki() (CLI subprocess) because VAULT_ROOT is frozen at module
 * load time, making in-process env overrides ineffective for hierarchy collectors.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, runGit, setupVaultAndRepo, setRepoFrontmatter, tempDir, initVault } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

// ─── Shared setup helpers ──────────────────────────────────────────────────────

/**
 * Bootstrap a project with a real git repo (needed by maintain/closeout/gate).
 * Returns env + paths for the feature/prd/slice directories.
 */
function setupProjectWithRepo(projectName = "demo") {
  const { vault, repo } = setupVaultAndRepo();
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", projectName], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, projectName);
  const base = runGit(repo, ["rev-parse", "HEAD~1"]).stdout.toString().trim();
  const projectRoot = join(vault, "projects", projectName);
  const featuresDir = join(projectRoot, "specs", "features");
  const prdsDir = join(projectRoot, "specs", "prds");
  const slicesDir = join(projectRoot, "specs", "slices");
  mkdirSync(featuresDir, { recursive: true });
  mkdirSync(prdsDir, { recursive: true });
  mkdirSync(slicesDir, { recursive: true });
  return { vault, repo, env, base, featuresDir, prdsDir, slicesDir };
}

function writeFeature(featuresDir: string, project: string, opts: { featureId: string; status: string; computedStatus?: string; completedAt?: string }) {
  const lines = [`---`, `title: '${opts.featureId} feature'`, `type: spec`, `spec_kind: feature`, `project: ${project}`, `feature_id: ${opts.featureId}`, `status: ${opts.status}`];
  if (opts.computedStatus) lines.push(`computed_status: ${opts.computedStatus}`);
  if (opts.completedAt) lines.push(`completed_at: '${opts.completedAt}'`);
  lines.push(`---`, `# ${opts.featureId}`, ``);
  // Use the canonical naming format expected by linting: FEAT-<nnn>-<slug>.md
  const slug = opts.featureId.toLowerCase().replace(/-/g, "-");
  writeFileSync(join(featuresDir, `${slug}-feature.md`), lines.join("\n"), "utf8");
}

function writePrd(prdsDir: string, project: string, opts: { prdId: string; parentFeature: string; status: string; computedStatus?: string; completedAt?: string }) {
  const lines = [`---`, `title: '${opts.prdId} prd'`, `type: spec`, `spec_kind: prd`, `project: ${project}`, `prd_id: ${opts.prdId}`, `parent_feature: ${opts.parentFeature}`, `status: ${opts.status}`];
  if (opts.computedStatus) lines.push(`computed_status: ${opts.computedStatus}`);
  if (opts.completedAt) lines.push(`completed_at: '${opts.completedAt}'`);
  lines.push(`---`, `# ${opts.prdId}`, ``);
  const slug = opts.prdId.toLowerCase().replace(/-/g, "-");
  writeFileSync(join(prdsDir, `${slug}-prd.md`), lines.join("\n"), "utf8");
}

function writeSlice(slicesDir: string, project: string, opts: { taskId: string; parentPrd?: string; parentFeature?: string; status: string; verificationLevel?: string; supersededBy?: string }) {
  const sliceDir = join(slicesDir, opts.taskId);
  mkdirSync(sliceDir, { recursive: true });
  const lines = [`---`, `title: ${opts.taskId}`, `type: spec`, `spec_kind: task-hub`, `project: ${project}`, `task_id: ${opts.taskId}`];
  if (opts.parentPrd) lines.push(`parent_prd: ${opts.parentPrd}`);
  if (opts.parentFeature) lines.push(`parent_feature: ${opts.parentFeature}`);
  lines.push(`status: ${opts.status}`);
  if (opts.verificationLevel) lines.push(`verification_level: ${opts.verificationLevel}`);
  if (opts.supersededBy) lines.push(`superseded_by: ${opts.supersededBy}`);
  lines.push(`---`, `# ${opts.taskId}`, ``);
  writeFileSync(join(sliceDir, "index.md"), lines.join("\n"), "utf8");
}

// ─── R1: computed_status persistence ──────────────────────────────────────────

describe("R1 — computed_status persistence", () => {
  test("maintain updates stale computed_status on feature and PRD pages", () => {
    const { vault, repo, env, base, featuresDir, prdsDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "in-progress", computedStatus: "not-started" });
    writePrd(prdsDir, "demo", { prdId: "PRD-001", parentFeature: "FEAT-001", status: "in-progress", computedStatus: "not-started" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentPrd: "PRD-001", parentFeature: "FEAT-001", status: "done", verificationLevel: "test-verified" });

    const result = runWiki(["maintain", "demo", "--repo", repo, "--base", base], env);
    expect(result.exitCode).toBe(0);

    const featureContent = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureContent).toContain("computed_status: complete");

    const prdContent = readFileSync(join(prdsDir, "prd-001-prd.md"), "utf8");
    expect(prdContent).toContain("computed_status: complete");
  });

  test("R1 idempotence: computed_status already correct on second run — no rewrite or extra log entry", () => {
    const { vault, repo, env, base, featuresDir, prdsDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "in-progress", computedStatus: "not-started" });
    writePrd(prdsDir, "demo", { prdId: "PRD-001", parentFeature: "FEAT-001", status: "in-progress" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentPrd: "PRD-001", parentFeature: "FEAT-001", status: "done", verificationLevel: "test-verified" });

    // First run — writes correct computed_status and logs auto-heal
    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const featureAfterFirst = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureAfterFirst).toContain("computed_status: complete");
    const logAfterFirst = readFileSync(join(vault, "log.md"), "utf8");
    const countAfterFirst = (logAfterFirst.match(/rule=R1/g) ?? []).length;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second run — already correct, no rewrite, no additional log entries
    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const featureAfterSecond = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureAfterSecond).toContain("computed_status: complete");
    const logAfterSecond = readFileSync(join(vault, "log.md"), "utf8");
    const countAfterSecond = (logAfterSecond.match(/rule=R1/g) ?? []).length;
    // Log count must not have grown — idempotent
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

// ─── R2: parent reopen ────────────────────────────────────────────────────────

describe("R2 — parent reopen on late-added child", () => {
  test("feature status=complete with draft child gets reopened and completed_at cleared", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "draft" });

    const result = runWiki(["maintain", "demo", "--repo", repo, "--base", base], env);
    expect(result.exitCode).toBe(0);

    const content = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(content).toContain("status: in-progress");
    expect(content).toContain("reopened_reason:");
    // completed_at should be removed by R2
    expect(content).not.toContain("completed_at:");
  });

  test("feature status=complete with in-progress child gets reopened and logs auto-heal", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "in-progress" });

    const result = runWiki(["maintain", "demo", "--repo", repo, "--base", base], env);
    expect(result.exitCode).toBe(0);

    const content = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(content).toContain("status: in-progress");
    expect(content).toContain("reopened_reason:");

    const log = readFileSync(join(vault, "log.md"), "utf8");
    expect(log).toContain("auto-heal");
    expect(log).toContain("rule=R2");
    expect(log).toContain("FEAT-001");
  });

  test("PRD status=complete with draft child gets reopened", () => {
    const { vault, repo, env, base, featuresDir, prdsDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "in-progress" });
    writePrd(prdsDir, "demo", { prdId: "PRD-001", parentFeature: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentPrd: "PRD-001", status: "draft" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    const prdContent = readFileSync(join(prdsDir, "prd-001-prd.md"), "utf8");
    expect(prdContent).toContain("status: in-progress");
    expect(prdContent).toContain("reopened_reason:");
    expect(prdContent).not.toContain("completed_at:");
  });

  test("R2 is idempotent: second run does not fire another heal", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "draft" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const logAfterFirst = readFileSync(join(vault, "log.md"), "utf8");
    const firstCount = (logAfterFirst.match(/rule=R2/g) ?? []).length;
    expect(firstCount).toBe(1);

    // Second run — feature is now in-progress, no drift, no new heal
    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const logAfterSecond = readFileSync(join(vault, "log.md"), "utf8");
    const secondCount = (logAfterSecond.match(/rule=R2/g) ?? []).length;
    expect(secondCount).toBe(1);
  });
});

// ─── R3: cancel-cascade ───────────────────────────────────────────────────────

describe("R3 — cancel-cascade on unanimous supersede", () => {
  test("parent with single cancelled+superseded child gets cascaded to cancelled", () => {
    const { vault, repo, env, base, featuresDir, prdsDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writePrd(prdsDir, "demo", { prdId: "PRD-001", parentFeature: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentPrd: "PRD-001", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-053" });

    const result = runWiki(["maintain", "demo", "--repo", repo, "--base", base], env);
    expect(result.exitCode).toBe(0);

    const prdContent = readFileSync(join(prdsDir, "prd-001-prd.md"), "utf8");
    expect(prdContent).toContain("status: cancelled");
    expect(prdContent).toContain("superseded_by: PRD-053");

    const log = readFileSync(join(vault, "log.md"), "utf8");
    expect(log).toContain("rule=R3");
    expect(log).toContain("superseded_by=PRD-053");
  });

  test("parent with all cancelled children and unanimous superseded_by (some empty) gets cascaded", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    // One child has superseded_by, another doesn't (empty = defer to the one that set it)
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-053" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-002", parentFeature: "FEAT-001", status: "cancelled" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    const featureContent = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureContent).toContain("status: cancelled");
    expect(featureContent).toContain("superseded_by: PRD-053");
  });

  test("R3 non-unanimous: two different superseded_by values — no heal, R4 escalation in output", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-053" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-002", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-054" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    // Feature should NOT be auto-cancelled — different superseded_by values (non-unanimous)
    const featureContent = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureContent).toContain("status: complete");
    expect(featureContent).not.toContain("status: cancelled");

    // R4 escalation should appear in maintain --json output
    const jsonResult = runWiki(["maintain", "demo", "--repo", repo, "--base", base, "--json"], env);
    expect(jsonResult.exitCode).toBe(0);
    const plan = JSON.parse(jsonResult.stdout.toString());
    const escalations = plan.actions.filter((a: { kind: string }) => a.kind === "lifecycle-escalate");
    expect(escalations.length).toBeGreaterThan(0);
    expect(escalations[0].message).toContain("wiki lifecycle open");
    expect(escalations[0].message).toContain("wiki lifecycle close");
  });

  test("R3 with no superseded_by on any child (all empty) — R4 escalation, no cascade", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "cancelled" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-002", parentFeature: "FEAT-001", status: "cancelled" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    const featureContent = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureContent).toContain("status: complete");
    expect(featureContent).not.toContain("status: cancelled");

    const jsonResult = runWiki(["maintain", "demo", "--repo", repo, "--base", base, "--json"], env);
    expect(jsonResult.exitCode).toBe(0);
    const plan = JSON.parse(jsonResult.stdout.toString());
    const escalations = plan.actions.filter((a: { kind: string }) => a.kind === "lifecycle-escalate");
    expect(escalations.length).toBeGreaterThan(0);
  });

  test("R3 idempotence: second run after cancel-cascade does not fire again", () => {
    const { vault, repo, env, base, featuresDir, prdsDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "in-progress" });
    writePrd(prdsDir, "demo", { prdId: "PRD-001", parentFeature: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentPrd: "PRD-001", status: "cancelled", supersededBy: "PRD-053" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const logAfterFirst = readFileSync(join(vault, "log.md"), "utf8");
    const firstCount = (logAfterFirst.match(/rule=R3/g) ?? []).length;
    expect(firstCount).toBe(1);

    // Second run — PRD is now cancelled, no drift, no new heal
    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);
    const logAfterSecond = readFileSync(join(vault, "log.md"), "utf8");
    const secondCount = (logAfterSecond.match(/rule=R3/g) ?? []).length;
    expect(secondCount).toBe(1);
  });
});

// ─── R4: escalation on ambiguity ──────────────────────────────────────────────

describe("R4 — escalation on ambiguity", () => {
  test("R2 takes priority when in-progress child coexists with cancelled sibling", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-053" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-002", parentFeature: "FEAT-001", status: "in-progress" });

    // R2 fires because DEMO-002 is in-progress (non-terminal child exists) → reopen
    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    const featureContent = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(featureContent).toContain("status: in-progress");
    expect(featureContent).toContain("reopened_reason:");
  });

  test("escalation message includes both inverse commands for operator clarity", () => {
    const { repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    // Two cancelled children with different superseded_by → R4
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-053" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-002", parentFeature: "FEAT-001", status: "cancelled", supersededBy: "PRD-099" });

    const jsonResult = runWiki(["maintain", "demo", "--repo", repo, "--base", base, "--json"], env);
    expect(jsonResult.exitCode).toBe(0);
    const plan = JSON.parse(jsonResult.stdout.toString());
    const escalation = plan.actions.find((a: { kind: string }) => a.kind === "lifecycle-escalate");
    expect(escalation).toBeDefined();
    expect(escalation.message).toContain("wiki lifecycle open");
    expect(escalation.message).toContain("wiki lifecycle close");
  });
});

// ─── Closeout apply-then-collect ──────────────────────────────────────────────

describe("closeout apply-then-collect contract", () => {
  test("closeout heals R2 drift and does not surface it as a warning", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "draft" });

    const result = runWiki(["closeout", "demo", "--repo", repo, "--base", base, "--json"], env);
    const stdout = result.stdout.toString();
    expect(stdout.length).toBeGreaterThan(0);
    const json = JSON.parse(stdout);
    // The R2 lifecycle-reopen message must NOT appear as a warning (it was healed)
    const reopenWarnings = (json.warnings ?? []).filter((w: string) => w.includes("status=complete") || w.includes("lifecycle-drift"));
    expect(reopenWarnings.length).toBe(0);

    // Feature was healed by R2 during closeout
    const content = readFileSync(join(featuresDir, "feat-001-feature.md"), "utf8");
    expect(content).toContain("status: in-progress");
  });

  test("closeout idempotence: second run does not produce lifecycle drift warnings", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "draft" });

    // First closeout — heals
    const first = runWiki(["closeout", "demo", "--repo", repo, "--base", base, "--json"], env);
    const firstJson = JSON.parse(first.stdout.toString());
    expect((firstJson.warnings ?? []).filter((w: string) => w.includes("status=complete")).length).toBe(0);

    // Second closeout — already healed, no new drift
    const second = runWiki(["closeout", "demo", "--repo", repo, "--base", base, "--json"], env);
    const secondJson = JSON.parse(second.stdout.toString());
    expect((secondJson.warnings ?? []).filter((w: string) => w.includes("status=complete")).length).toBe(0);
  });
});

// ─── Audit log entries ────────────────────────────────────────────────────────

describe("audit log", () => {
  test("auto-heal log entries are written for each entity and rule that fires", () => {
    const { vault, repo, env, base, featuresDir, prdsDir, slicesDir } = setupProjectWithRepo();

    // PRD-001 and FEAT-001 are complete, with a draft child — R2 fires for each
    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writePrd(prdsDir, "demo", { prdId: "PRD-001", parentFeature: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentPrd: "PRD-001", parentFeature: "FEAT-001", status: "draft" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    const log = readFileSync(join(vault, "log.md"), "utf8");
    // R2 fires for FEAT-001 and PRD-001 (each has a non-terminal child)
    expect(log).toContain("auto-heal | FEAT-001");
    expect(log).toContain("auto-heal | PRD-001");
    expect(log).toContain("rule=R2");
    // R1 (computed_status write) also fires for each entity after R2 changes their status
    // Both rule=R2 and rule=R1 entries may exist for the same entity in one run — that is correct
    expect(log).toContain("rule=R1");
  });

  test("log entries follow ## [YYYY-MM-DD] auto-heal | ENTITY format (parseable by tail-log)", () => {
    const { vault, repo, env, base, featuresDir, slicesDir } = setupProjectWithRepo();

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "in-progress" });

    expect(runWiki(["maintain", "demo", "--repo", repo, "--base", base], env).exitCode).toBe(0);

    const logContent = readFileSync(join(vault, "log.md"), "utf8");
    const healEntries = logContent.split("\n").filter((l) => l.startsWith("## ") && l.includes("auto-heal"));
    expect(healEntries.length).toBeGreaterThan(0);
    for (const entry of healEntries) {
      expect(entry).toMatch(/^## \[\d{4}-\d{2}-\d{2}\] auto-heal \| /);
    }
  });
});

// ─── Session recovery guarantee ───────────────────────────────────────────────

describe("session recovery not blocked by parent drift", () => {
  test("wiki resume exits without a crash when parent drift is present", () => {
    const vault = tempDir("resume-drift");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const featuresDir = join(vault, "projects", "demo", "specs", "features");
    const slicesDir = join(vault, "projects", "demo", "specs", "slices");
    mkdirSync(featuresDir, { recursive: true });
    mkdirSync(slicesDir, { recursive: true });

    writeFeature(featuresDir, "demo", { featureId: "FEAT-001", status: "complete", completedAt: "2026-01-01T00:00:00.000Z" });
    writeSlice(slicesDir, "demo", { taskId: "DEMO-001", parentFeature: "FEAT-001", status: "draft" });

    // resume may exit non-zero for other reasons (no repo configured),
    // but must exit via process.exit, not an uncaught crash (signalCode non-null = crash kill).
    const result = runWiki(["resume", "demo"], env);
    // A non-null signalCode would indicate the process was killed by a signal (crash)
    // Bun's spawnSync returns signalCode for signals, exitCode for normal exit
    expect(result.exitCode).not.toBeNull(); // normal exit (not signal)
  });
});
