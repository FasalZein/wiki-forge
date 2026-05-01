import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, tempDir } from "../test-helpers";
import { writeAmendmentDocs } from "../../src/forge/vault/amendment-docs";
import { readClosedForgeSliceHub } from "../../src/forge/vault/closed-slice";
import {
  assertForgeSliceDocumentsMissing,
  forgeArtifactPath,
  forgeArtifactSlug,
  forgeSequenceId,
  forgeSliceDocumentPaths,
  nextForgeSequenceId,
} from "../../src/forge/vault/forge-artifacts";
import { loadForgeProjectState } from "../../src/forge/vault/slice-project-state";
import { updateSliceFrontmatter } from "../../src/forge/vault/slice-frontmatter";
import { renderPlanningSessionBody } from "../../src/forge/vault/planning-session-rendering";
import { renderForgeSliceStatusText } from "../../src/forge/workflow/render-slice-status";

afterEach(() => cleanupTempPaths());

describe("Forge vault artifact primitives", () => {
  test("allocates canonical feature PRD and slice ids from the vault layout", async () => {
    const vault = tempDir("forge-artifacts-vault");
    mkdirSync(join(vault, "projects", "wiki-forge", "forge", "features"), { recursive: true });
    mkdirSync(join(vault, "projects", "wiki-forge", "forge", "prds"), { recursive: true });
    mkdirSync(join(vault, "projects", "wiki-forge", "forge", "slices", "WIKI-FORGE-044"), { recursive: true });
    writeFileSync(join(vault, "projects", "wiki-forge", "forge", "features", "FEAT-031-existing.md"), "", "utf8");
    writeFileSync(join(vault, "projects", "wiki-forge", "forge", "prds", "PRD-034-existing.md"), "", "utf8");

    await expect(nextForgeSequenceId(vault, "wiki-forge", "feature")).resolves.toBe("FEAT-032");
    await expect(nextForgeSequenceId(vault, "wiki-forge", "prd")).resolves.toBe("PRD-035");
    await expect(nextForgeSequenceId(vault, "wiki-forge", "slice")).resolves.toBe("WIKI-FORGE-045");
  });

  test("returns canonical absolute paths for a Forge slice document set", () => {
    const vault = tempDir("forge-artifact-paths-vault");

    expect(forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-044")).toEqual({
      dir: join(vault, "projects/wiki-forge/forge/slices/WIKI-FORGE-044"),
      indexPath: join(vault, "projects/wiki-forge/forge/slices/WIKI-FORGE-044/index.md"),
      planPath: join(vault, "projects/wiki-forge/forge/slices/WIKI-FORGE-044/plan.md"),
      testPlanPath: join(vault, "projects/wiki-forge/forge/slices/WIKI-FORGE-044/test-plan.md"),
    });
  });

  test("normalizes artifact ids slugs paths and duplicate slice docs", () => {
    const vault = tempDir("forge-artifact-duplicate-vault");
    const paths = forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-044");

    expect(forgeSequenceId("wiki-forge", "slice", 7)).toBe("WIKI-FORGE-007");
    expect(forgeArtifactSlug("  Auth: Rollout Plan! ")).toBe("auth-rollout-plan");
    expect(forgeArtifactPath("wiki-forge", "feature", "FEAT-001", "auth")).toBe("projects/wiki-forge/forge/features/FEAT-001-auth.md");
    expect(forgeArtifactPath("wiki-forge", "prd", "PRD-002", "login")).toBe("projects/wiki-forge/forge/prds/PRD-002-login.md");
    expect(forgeArtifactPath("wiki-forge", "slice", "WIKI-FORGE-003")).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-003/index.md");

    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.indexPath, "# existing\n", "utf8");

    expect(() => assertForgeSliceDocumentsMissing(paths, "WIKI-FORGE-044")).toThrow("slice docs already exist for WIKI-FORGE-044");
  });

  test("writes amendment hub plan and test plan with immutable closed-slice context", () => {
    const vault = tempDir("forge-amendment-docs-vault");
    const paths = forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-045");
    mkdirSync(paths.dir, { recursive: true });

    writeAmendmentDocs({
      project: "wiki-forge",
      closedSliceId: "WIKI-FORGE-044",
      amendmentSliceId: "WIKI-FORGE-045",
      title: "Follow-up repair",
      reason: "coverage gap found during review",
      createdAt: "2026-05-01T00:00:00.000Z",
      sourcePaths: ["src/forge/vault/amendment-docs.ts"],
      parentPrd: "PRD-001",
      parentFeature: "FEAT-001",
      paths,
    });

    expect(readFileSync(paths.indexPath, "utf8")).toContain("amendment_of: WIKI-FORGE-044");
    expect(readFileSync(paths.indexPath, "utf8")).toContain("The closed slice remains immutable");
    expect(readFileSync(paths.planPath, "utf8")).toContain("Preserve the original close evidence");
    expect(readFileSync(paths.testPlanPath, "utf8")).toContain("Add regression coverage");
  });

  test("renders planning session gate state without mutating lifecycle data", () => {
    const body = renderPlanningSessionBody({
      project: "wiki-forge",
      featureName: "Architecture cleanup",
      sessionId: "plan-001",
      status: "draft",
      createdAt: "2026-05-01T00:00:00.000Z",
      updated: "2026-05-01T00:00:00.000Z",
      answers: {},
      prds: [{ name: "Vault primitives", slices: ["WIKI-FORGE-044"] }],
      artifacts: {},
    }, { missing: ["domain-model", "prd"] });

    expect(body).toContain("Status: draft");
    expect(body).toContain("Missing: domain-model, prd");
    expect(body).toContain("- Vault primitives");
    expect(body).toContain("  - Slice: WIKI-FORGE-044");
  });

  test("renders slice status text for healthy and repair states", () => {
    expect(renderForgeSliceStatusText({ project: "wiki-forge", sliceId: "WIKI-FORGE-404", status: "missing" })).toBe("wiki-forge/WIKI-FORGE-404: missing canonical slice hub");
    expect(renderForgeSliceStatusText({ project: "wiki-forge", sliceId: "WIKI-FORGE-045", status: "needs-repair" })).toBe("wiki-forge/WIKI-FORGE-045: repair canonical slice hub");
    expect(renderForgeSliceStatusText({
      project: "wiki-forge",
      sliceId: "WIKI-FORGE-044",
      status: "active",
      lifecycleStatus: "implementation",
      nextAction: "run targeted verification",
    })).toBe("wiki-forge/WIKI-FORGE-044: active\nlifecycle: implementation\nnext: run targeted verification");
  });

  test("updates slice frontmatter without rewriting slice body intent", async () => {
    const vault = tempDir("forge-slice-frontmatter-vault");
    const paths = forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-044");
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.indexPath, sliceMarkdown({ status: "draft", extra: "claimed_by: old-agent\n" }), "utf8");

    await updateSliceFrontmatter("wiki-forge", "WIKI-FORGE-044", { status: "in-progress", claimed_by: "codex" }, ["extra_field"], vault);

    const updated = readFileSync(paths.indexPath, "utf8");
    expect(updated).toContain("status: in-progress");
    expect(updated).toContain("claimed_by: codex");
    expect(updated).toContain("# WIKI-FORGE-044");
  });

  test("loads active Forge project state from canonical slice records", async () => {
    const vault = tempDir("forge-project-state-vault");
    const activePaths = forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-044");
    const donePaths = forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-043");
    mkdirSync(activePaths.dir, { recursive: true });
    mkdirSync(donePaths.dir, { recursive: true });
    writeFileSync(activePaths.indexPath, sliceMarkdown({ sliceId: "WIKI-FORGE-044", status: "in-progress", extra: "claimed_by: codex\n" }), "utf8");
    writeFileSync(donePaths.indexPath, sliceMarkdown({ sliceId: "WIKI-FORGE-043", status: "done" }), "utf8");

    await expect(loadForgeProjectState("wiki-forge", vault)).resolves.toEqual({
      project: "wiki-forge",
      activeSlices: [{ project: "wiki-forge", sliceId: "WIKI-FORGE-044", claimedBy: "codex" }],
    });
  });

  test("accepts closed slice hubs only when canonical truth and close evidence agree", async () => {
    const vault = tempDir("forge-closed-slice-vault");
    const paths = forgeSliceDocumentPaths(vault, "wiki-forge", "WIKI-FORGE-044");
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.indexPath, sliceMarkdown({
      status: "done",
      extra: "forge_closure_evidence:\n  - tdd\n  - verification\n  - review\n",
    }), "utf8");

    const document = await readClosedForgeSliceHub("wiki-forge", "WIKI-FORGE-044", vault);

    expect(document.path).toBe("projects/wiki-forge/forge/slices/WIKI-FORGE-044/index.md");
    expect(document.frontmatter.status).toBe("done");
  });
});

function sliceMarkdown(input: { readonly sliceId?: string; readonly status: "draft" | "in-progress" | "done"; readonly extra?: string }): string {
  const sliceId = input.sliceId ?? "WIKI-FORGE-044";
  return [
    "---",
    `title: ${sliceId}`,
    "type: forge-slice",
    "project: wiki-forge",
    `task_id: ${sliceId}`,
    "parent_feature: FEAT-001",
    "parent_prd: PRD-001",
    `status: ${input.status}`,
    "created_at: 2026-05-01T00:00:00.000Z",
    "updated: 2026-05-01T00:00:00.000Z",
    ...(input.extra ? [input.extra.trimEnd()] : []),
    "---",
    `# ${sliceId}`,
    "",
  ].join("\n");
}
