import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

// ─── Test setup helpers ───────────────────────────────────────────────────────

function setupProjectWithFeatureAndPrd(vault: string, project: string) {
  const projectRoot = join(vault, "projects", project);
  const specsDir = join(projectRoot, "specs");
  const featuresDir = join(specsDir, "features");
  const prdsDir = join(specsDir, "prds");
  const slicesDir = join(specsDir, "slices");

  for (const dir of [projectRoot, specsDir, featuresDir, prdsDir, slicesDir]) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    join(projectRoot, "_summary.md"),
    `---\ntitle: "${project}"\ntype: project\nproject: ${project}\nstatus: current\n---\n# ${project}\n`,
    "utf8",
  );

  // Feature FEAT-001
  writeFileSync(
    join(featuresDir, "FEAT-001-alpha.md"),
    `---\ntitle: FEAT-001 Alpha\ntype: spec\nspec_kind: feature\nproject: ${project}\nfeature_id: FEAT-001\nstatus: draft\n---\n# FEAT-001\n`,
    "utf8",
  );

  // PRD-001 under FEAT-001
  writeFileSync(
    join(prdsDir, "PRD-001-alpha.md"),
    `---\ntitle: PRD-001 Alpha\ntype: spec\nspec_kind: prd\nproject: ${project}\nprd_id: PRD-001\nparent_feature: FEAT-001\nstatus: draft\n---\n# PRD-001\n`,
    "utf8",
  );

  return { featuresDir, prdsDir, slicesDir };
}

function addSlice(vault: string, project: string, taskId: string, opts: { status: string; verificationLevel?: string; parentPrd?: string; parentFeature?: string }) {
  const slicesDir = join(vault, "projects", project, "specs", "slices");
  const sliceDir = join(slicesDir, taskId);
  mkdirSync(sliceDir, { recursive: true });
  const vl = opts.verificationLevel ? `\nverification_level: ${opts.verificationLevel}` : "";
  const parentPrd = opts.parentPrd ? `\nparent_prd: ${opts.parentPrd}` : "";
  const parentFeature = opts.parentFeature ? `\nparent_feature: ${opts.parentFeature}` : "";
  writeFileSync(
    join(sliceDir, "index.md"),
    `---\ntitle: ${taskId}\ntype: spec\nspec_kind: task-hub\nproject: ${project}\ntask_id: ${taskId}${parentPrd}${parentFeature}\nstatus: ${opts.status}${vl}\n---\n# ${taskId}\n`,
    "utf8",
  );
}

// ─── start-feature ────────────────────────────────────────────────────────────

describe("wiki start-feature", () => {
  test("sets status=in-progress and started_at on feature page", () => {
    const vault = tempDir("start-feat");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["start-feature", "proj", "FEAT-001"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("started feature FEAT-001");

    const content = readFileSync(join(featuresDir, "FEAT-001-alpha.md"), "utf8");
    expect(content).toContain("status: in-progress");
    expect(content).toContain("started_at:");
  });

  test("errors when feature page is not found", () => {
    const vault = tempDir("start-feat-missing");
    initVault(vault);
    setupProjectWithFeatureAndPrd(vault, "proj");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["start-feature", "proj", "FEAT-999"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("not found");
  });

  test("errors when feature is already in-progress", () => {
    const vault = tempDir("start-feat-dup");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    // Put it in-progress first
    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );

    const result = runWiki(["start-feature", "proj", "FEAT-001"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("already in-progress");
  });

  test("errors when feature is already complete", () => {
    const vault = tempDir("start-feat-complete");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: complete\n---\n# FEAT-001\n`,
      "utf8",
    );

    const result = runWiki(["start-feature", "proj", "FEAT-001"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("already complete");
  });
});

// ─── close-feature ────────────────────────────────────────────────────────────

describe("wiki close-feature", () => {
  test("--force alone blocks and asks for a second acknowledgement", () => {
    const vault = tempDir("close-feat-force-blocked");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-feature", "proj", "FEAT-001", "--force"], env);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("--yes-really-force");

    const content = readFileSync(join(featuresDir, "FEAT-001-alpha.md"), "utf8");
    expect(content).toContain("status: in-progress");
    expect(content).not.toContain("completed_at:");
  });

  test("--force closes feature regardless of computed status", () => {
    const vault = tempDir("close-feat-force");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    // Start it first
    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-feature", "proj", "FEAT-001", "--force", "--yes-really-force"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("closed feature FEAT-001 (forced)");
    // Authored status is "in-progress" and there are no child slices yet —
    // computed_status reflects the authored status (PRD-055 authored-wins semantics).
    expect(result.stdout.toString()).toContain('computed_status="in-progress"');

    const content = readFileSync(join(featuresDir, "FEAT-001-alpha.md"), "utf8");
    expect(content).toContain("status: complete");
    expect(content).toContain("completed_at:");
  });

  test("without --force fails when computed status is not complete", () => {
    const vault = tempDir("close-feat-gate");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );
    // Add an in-progress slice so computed = in-progress, not complete
    addSlice(vault, "proj", "PROJ-001", { status: "in-progress", parentFeature: "FEAT-001" });
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-feature", "proj", "FEAT-001"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("not complete");
  });

  test("without --force succeeds when all slices are done and test-verified", () => {
    const vault = tempDir("close-feat-ok");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );
    addSlice(vault, "proj", "PROJ-001", { status: "done", verificationLevel: "test-verified", parentFeature: "FEAT-001" });
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-feature", "proj", "FEAT-001"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("closed feature FEAT-001");

    const content = readFileSync(join(featuresDir, "FEAT-001-alpha.md"), "utf8");
    expect(content).toContain("status: complete");
    expect(content).toContain("completed_at:");
  });
});

// ─── start-prd ───────────────────────────────────────────────────────────────

describe("wiki start-prd", () => {
  test("sets status=in-progress and started_at on PRD page", () => {
    const vault = tempDir("start-prd");
    initVault(vault);
    const { prdsDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["start-prd", "proj", "PRD-001"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("started prd PRD-001");

    const content = readFileSync(join(prdsDir, "PRD-001-alpha.md"), "utf8");
    expect(content).toContain("status: in-progress");
    expect(content).toContain("started_at:");
  });

  test("errors when PRD is not found", () => {
    const vault = tempDir("start-prd-missing");
    initVault(vault);
    setupProjectWithFeatureAndPrd(vault, "proj");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["start-prd", "proj", "PRD-999"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("not found");
  });

  test("errors when PRD is already in-progress", () => {
    const vault = tempDir("start-prd-dup");
    initVault(vault);
    const { prdsDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(prdsDir, "PRD-001-alpha.md"),
      `---\ntitle: PRD-001\ntype: spec\nspec_kind: prd\nproject: proj\nprd_id: PRD-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# PRD-001\n`,
      "utf8",
    );
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["start-prd", "proj", "PRD-001"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("already in-progress");
  });
});

// ─── close-prd ───────────────────────────────────────────────────────────────

describe("wiki close-prd", () => {
  test("--force alone blocks and asks for a second acknowledgement", () => {
    const vault = tempDir("close-prd-force-blocked");
    initVault(vault);
    const { prdsDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(prdsDir, "PRD-001-alpha.md"),
      `---\ntitle: PRD-001\ntype: spec\nspec_kind: prd\nproject: proj\nprd_id: PRD-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# PRD-001\n`,
      "utf8",
    );
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-prd", "proj", "PRD-001", "--force"], env);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("--yes-really-force");

    const content = readFileSync(join(prdsDir, "PRD-001-alpha.md"), "utf8");
    expect(content).toContain("status: in-progress");
    expect(content).not.toContain("completed_at:");
  });

  test("--force closes PRD regardless of computed status", () => {
    const vault = tempDir("close-prd-force");
    initVault(vault);
    const { prdsDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(prdsDir, "PRD-001-alpha.md"),
      `---\ntitle: PRD-001\ntype: spec\nspec_kind: prd\nproject: proj\nprd_id: PRD-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# PRD-001\n`,
      "utf8",
    );
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-prd", "proj", "PRD-001", "--force", "--yes-really-force"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("closed prd PRD-001 (forced)");
    // Authored status is "in-progress" and there are no child slices yet —
    // computed_status reflects the authored status (PRD-055 authored-wins semantics).
    expect(result.stdout.toString()).toContain('computed_status="in-progress"');

    const content = readFileSync(join(prdsDir, "PRD-001-alpha.md"), "utf8");
    expect(content).toContain("status: complete");
    expect(content).toContain("completed_at:");
  });

  test("without --force fails when computed status is not complete", () => {
    const vault = tempDir("close-prd-gate");
    initVault(vault);
    const { prdsDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(prdsDir, "PRD-001-alpha.md"),
      `---\ntitle: PRD-001\ntype: spec\nspec_kind: prd\nproject: proj\nprd_id: PRD-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# PRD-001\n`,
      "utf8",
    );
    addSlice(vault, "proj", "PROJ-001", { status: "in-progress", parentPrd: "PRD-001" });
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-prd", "proj", "PRD-001"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("not complete");
  });

  test("without --force succeeds when all slices done and test-verified", () => {
    const vault = tempDir("close-prd-ok");
    initVault(vault);
    const { prdsDir } = setupProjectWithFeatureAndPrd(vault, "proj");
    writeFileSync(
      join(prdsDir, "PRD-001-alpha.md"),
      `---\ntitle: PRD-001\ntype: spec\nspec_kind: prd\nproject: proj\nprd_id: PRD-001\nstatus: in-progress\nstarted_at: 2026-01-01T00:00:00.000Z\n---\n# PRD-001\n`,
      "utf8",
    );
    addSlice(vault, "proj", "PROJ-001", { status: "done", verificationLevel: "test-verified", parentPrd: "PRD-001" });
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["close-prd", "proj", "PRD-001"], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("closed prd PRD-001");

    const content = readFileSync(join(prdsDir, "PRD-001-alpha.md"), "utf8");
    expect(content).toContain("status: complete");
    expect(content).toContain("completed_at:");
  });
});

// ─── Lifecycle drift detection via feature-status (integration) ───────────────
// We test drift detection by setting up the pages manually and verifying
// that start/close commands reflect the expected semantics (the underlying
// collectLifecycleDriftActions is exercised via start/close feature paths).
// Direct unit tests for collectLifecycleDriftActions are skipped because
// VAULT_ROOT is frozen at module load time, making in-process env overrides
// ineffective. The CLI-based tests above cover the relevant behaviors end-to-end.

describe("lifecycle drift: feature status=complete with non-complete computed", () => {
  test("feature-status reports complete when all slices are done+test-verified", () => {
    const vault = tempDir("lifecycle-drift-feat");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");

    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: complete\ncompleted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );
    addSlice(vault, "proj", "PROJ-001", { status: "done", verificationLevel: "test-verified", parentFeature: "FEAT-001" });

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const result = runWiki(["feature-status", "proj", "--json"], env);
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    expect(rows[0].computedStatus).toBe("complete");
  });

  test("feature-status exposes non-complete computed when feature is marked complete too early", () => {
    const vault = tempDir("lifecycle-drift-mismatch");
    initVault(vault);
    const { featuresDir } = setupProjectWithFeatureAndPrd(vault, "proj");

    writeFileSync(
      join(featuresDir, "FEAT-001-alpha.md"),
      `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: proj\nfeature_id: FEAT-001\nstatus: complete\ncompleted_at: 2026-01-01T00:00:00.000Z\n---\n# FEAT-001\n`,
      "utf8",
    );
    // Slice only code-verified, so computed = needs-verification
    addSlice(vault, "proj", "PROJ-001", { status: "done", verificationLevel: "code-verified", parentFeature: "FEAT-001" });

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    const result = runWiki(["feature-status", "proj", "--json"], env);
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    // computed status reveals the drift
    expect(rows[0].computedStatus).toBe("needs-verification");
  });
});
