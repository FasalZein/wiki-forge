import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeStatus, type SliceState } from "../src/lib/hierarchy";
import { tempDir, cleanupTempPaths, initVault, runWiki } from "./test-helpers";

afterAll(cleanupTempPaths);

// ─── Unit tests for computeStatus ────────────────────────────────────────────

describe("computeStatus", () => {
  test("returns not-started for empty slice list", () => {
    expect(computeStatus([])).toBe("not-started");
  });

  test("returns not-started when all slices are draft", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "draft", verificationLevel: null },
      { taskId: "PROJ-002", status: "draft", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("not-started");
  });

  test("returns not-started when all slices are cancelled", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "cancelled", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("not-started");
  });

  test("returns not-started when mix of draft and cancelled", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "draft", verificationLevel: null },
      { taskId: "PROJ-002", status: "cancelled", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("not-started");
  });

  test("returns in-progress when at least one slice is in-progress", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "in-progress", verificationLevel: null },
      { taskId: "PROJ-002", status: "draft", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("in-progress");
  });

  test("returns in-progress when some done but not all", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: "test-verified" },
      { taskId: "PROJ-002", status: "draft", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("in-progress");
  });

  test("returns in-progress when one sibling stays active after another is complete", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: "test-verified" },
      { taskId: "PROJ-002", status: "in-progress", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("in-progress");
  });

  test("returns needs-verification when all done but not all test-verified", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: "code-verified" },
      { taskId: "PROJ-002", status: "done", verificationLevel: "test-verified" },
    ];
    expect(computeStatus(slices)).toBe("needs-verification");
  });

  test("returns needs-verification when all done but none verified", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("needs-verification");
  });

  test("returns complete when all done and all test-verified", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: "test-verified" },
      { taskId: "PROJ-002", status: "done", verificationLevel: "test-verified" },
    ];
    expect(computeStatus(slices)).toBe("complete");
  });

  test("excludes cancelled from denominator for complete check", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: "test-verified" },
      { taskId: "PROJ-002", status: "cancelled", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("complete");
  });

  test("excludes cancelled from denominator for needs-verification check", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "done", verificationLevel: "code-verified" },
      { taskId: "PROJ-002", status: "cancelled", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("needs-verification");
  });

  test("excludes cancelled from denominator for in-progress check", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: "in-progress", verificationLevel: null },
      { taskId: "PROJ-002", status: "cancelled", verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("in-progress");
  });

  test("handles null status as draft (not-started)", () => {
    const slices: SliceState[] = [
      { taskId: "PROJ-001", status: null, verificationLevel: null },
    ];
    expect(computeStatus(slices)).toBe("not-started");
  });
});

// ─── Integration test for wiki feature-status ────────────────────────────────

describe("wiki feature-status", () => {
  function setupProject(vault: string, project: string) {
    const projectRoot = join(vault, "projects", project);
    const specsDir = join(projectRoot, "specs");
    const featuresDir = join(specsDir, "features");
    const prdsDir = join(specsDir, "prds");
    const slicesDir = join(specsDir, "slices");

    for (const dir of [projectRoot, specsDir, featuresDir, prdsDir, slicesDir]) {
      mkdirSync(dir, { recursive: true });
    }

    // summary
    writeFileSync(join(projectRoot, "_summary.md"), `---\ntitle: "${project}"\ntype: project\nproject: ${project}\nstatus: current\n---\n# ${project}\n`, "utf8");

    // Feature FEAT-001
    writeFileSync(join(featuresDir, "FEAT-001-alpha.md"), `---\ntitle: FEAT-001 Alpha\ntype: spec\nspec_kind: feature\nproject: ${project}\nfeature_id: FEAT-001\nstatus: draft\n---\n# FEAT-001\n`, "utf8");

    // PRD-001 under FEAT-001
    writeFileSync(join(prdsDir, "PRD-001-alpha.md"), `---\ntitle: PRD-001 Alpha\ntype: spec\nspec_kind: prd\nproject: ${project}\nprd_id: PRD-001\nparent_feature: FEAT-001\nstatus: draft\n---\n# PRD-001\n`, "utf8");

    // Slices under PRD-001 / FEAT-001
    mkdirSync(join(slicesDir, "PROJ-001"), { recursive: true });
    writeFileSync(join(slicesDir, "PROJ-001", "index.md"), `---\ntitle: PROJ-001\ntype: spec\nspec_kind: task-hub\nproject: ${project}\ntask_id: PROJ-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nstatus: done\nverification_level: test-verified\n---\n# PROJ-001\n`, "utf8");

    mkdirSync(join(slicesDir, "PROJ-002"), { recursive: true });
    writeFileSync(join(slicesDir, "PROJ-002", "index.md"), `---\ntitle: PROJ-002\ntype: spec\nspec_kind: task-hub\nproject: ${project}\ntask_id: PROJ-002\nparent_prd: PRD-001\nparent_feature: FEAT-001\nstatus: done\nverification_level: code-verified\n---\n# PROJ-002\n`, "utf8");
  }

  test("outputs feature and PRD statuses in table format", () => {
    const vault = tempDir("hierarchy-int");
    initVault(vault);
    setupProject(vault, "test-proj");

    const result = runWiki(["feature-status", "test-proj"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("FEAT-001");
    // All done but not all test-verified => needs-verification
    expect(out).toContain("needs-verification");
  });

  test("outputs json when --json flag is provided", () => {
    const vault = tempDir("hierarchy-json");
    initVault(vault);
    setupProject(vault, "test-proj");

    const result = runWiki(["feature-status", "test-proj", "--json"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0].featureId).toBe("FEAT-001");
    expect(rows[0].computedStatus).toBe("needs-verification");
    expect(rows[0].prds[0].prdId).toBe("PRD-001");
    expect(rows[0].prds[0].computedStatus).toBe("needs-verification");
  });

  test("reports complete when all slices are done and test-verified", () => {
    const vault = tempDir("hierarchy-complete");
    initVault(vault);
    const project = "test-proj";
    const projectRoot = join(vault, "projects", project);
    const specsDir = join(projectRoot, "specs");
    const featuresDir = join(specsDir, "features");
    const prdsDir = join(specsDir, "prds");
    const slicesDir = join(specsDir, "slices");
    for (const dir of [projectRoot, specsDir, featuresDir, prdsDir, slicesDir]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(projectRoot, "_summary.md"), `---\ntitle: "test-proj"\ntype: project\nproject: test-proj\nstatus: current\n---\n`, "utf8");
    writeFileSync(join(featuresDir, "FEAT-001-beta.md"), `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: test-proj\nfeature_id: FEAT-001\nstatus: draft\n---\n`, "utf8");
    writeFileSync(join(prdsDir, "PRD-001-beta.md"), `---\ntitle: PRD-001\ntype: spec\nspec_kind: prd\nproject: test-proj\nprd_id: PRD-001\nparent_feature: FEAT-001\nstatus: draft\n---\n`, "utf8");
    mkdirSync(join(slicesDir, "PROJ-001"), { recursive: true });
    writeFileSync(join(slicesDir, "PROJ-001", "index.md"), `---\ntitle: PROJ-001\ntype: spec\nspec_kind: task-hub\nproject: test-proj\ntask_id: PROJ-001\nparent_prd: PRD-001\nparent_feature: FEAT-001\nstatus: done\nverification_level: test-verified\n---\n`, "utf8");

    const result = runWiki(["feature-status", "test-proj", "--json"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    expect(rows[0].computedStatus).toBe("complete");
  });

  test("reports not-started for feature with no slices", () => {
    const vault = tempDir("hierarchy-empty");
    initVault(vault);
    const project = "test-proj";
    const projectRoot = join(vault, "projects", project);
    const specsDir = join(projectRoot, "specs");
    const featuresDir = join(specsDir, "features");
    const prdsDir = join(specsDir, "prds");
    const slicesDir = join(specsDir, "slices");
    for (const dir of [projectRoot, specsDir, featuresDir, prdsDir, slicesDir]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(projectRoot, "_summary.md"), `---\ntitle: "test-proj"\ntype: project\nproject: test-proj\nstatus: current\n---\n`, "utf8");
    writeFileSync(join(featuresDir, "FEAT-001-empty.md"), `---\ntitle: FEAT-001\ntype: spec\nspec_kind: feature\nproject: test-proj\nfeature_id: FEAT-001\nstatus: draft\n---\n`, "utf8");

    const result = runWiki(["feature-status", "test-proj", "--json"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    expect(rows[0].computedStatus).toBe("not-started");
  });
});
