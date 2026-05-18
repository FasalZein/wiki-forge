import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_DIRS } from "../src/constants";
import {
  classifyProjectDocPath,
  isAllowedProjectDocPath,
  isCanonicalFeatureId,
  isCanonicalPrdId,
  isCanonicalTaskId,
  projectModuleSpecPath,
  projectOnboardingPlanPath,
  workspaceIndexPath,
  workspaceProjectsDashboardPath,
} from "../src/lib/structure";
import { classifyRawPath, classifyResearchPath, describeAllowedResearchPaths, isAllowedRawBucket, normalizeResearchPageRef } from "../src/lib/research";

describe("project path primitives", () => {
  test("build canonical project support paths", () => {
    expect(projectOnboardingPlanPath("demo")).toEndWith("/projects/demo/specs/onboarding-plan.md");
    expect(projectModuleSpecPath("demo", "auth")).toEndWith("/projects/demo/modules/auth/spec.md");
    expect(workspaceIndexPath()).toEndWith("/index.md");
    expect(workspaceProjectsDashboardPath()).toEndWith("/projects/_dashboard.md");
  });

  test("does not expose specs-backed lifecycle path builders", () => {
    const structureBarrel = readFileSync(join(import.meta.dir, "..", "src", "lib", "structure.ts"), "utf8");
    const projectPaths = readFileSync(join(import.meta.dir, "..", "src", "lib", "project-paths", "index.ts"), "utf8");

    for (const legacyBuilder of ["projectFeaturePath", "projectPrdPath", "projectPlanPath", "projectTestPlanPath"]) {
      expect(structureBarrel).not.toContain(legacyBuilder);
      expect(projectPaths).not.toContain(`function ${legacyBuilder}`);
    }
  });

  test("validate canonical task ids", () => {
    expect(isCanonicalTaskId("DEMO-015")).toBe(true);
    expect(isCanonicalTaskId("WIKI-FORGE-015")).toBe(true);
    expect(isCanonicalTaskId("demo-015")).toBe(false);
    expect(isCanonicalTaskId("notes")).toBe(false);
    expect(isCanonicalFeatureId("FEAT-001")).toBe(true);
    expect(isCanonicalFeatureId("feature-001")).toBe(false);
    expect(isCanonicalPrdId("PRD-001")).toBe(true);
    expect(isCanonicalPrdId("prd-001")).toBe(false);
  });
});

describe("project structure contract", () => {
  test("allows current canonical project doc families", () => {
    expect(classifyProjectDocPath("_summary.md")).toBe("project-file");
    expect(classifyProjectDocPath("modules/auth/spec.md")).toBe("module-spec");
    expect(classifyProjectDocPath("architecture/context-map.md")).toBe("freeform-zone-doc");
    expect(classifyProjectDocPath("specs/index.md")).toBe("spec-index");
    expect(classifyProjectDocPath("specs/features/index.md")).toBe("spec-features-index");
    expect(classifyProjectDocPath("specs/prds/index.md")).toBe("spec-prds-index");
    expect(classifyProjectDocPath("specs/slices/index.md")).toBe("spec-slices-index");
    expect(classifyProjectDocPath("specs/archive/index.md")).toBe("spec-archive-index");
    expect(classifyProjectDocPath("specs/onboarding-plan.md")).toBe("spec-onboarding-plan");
    expect(classifyProjectDocPath("specs/features/FEAT-001-auth-platform.md")).toBe("spec-feature");
    expect(classifyProjectDocPath("specs/prds/PRD-001-auth-flow.md")).toBe("spec-prd");
    expect(classifyProjectDocPath("specs/plan-auth-rollout.md")).toBe("spec-plan");
    expect(classifyProjectDocPath("specs/test-plan-auth-rollout.md")).toBe("spec-test-plan");
    expect(classifyProjectDocPath("specs/slices/DEMO-015/index.md")).toBe("task-hub-index");
    expect(classifyProjectDocPath("specs/slices/DEMO-015/plan.md")).toBe("task-hub-plan");
    expect(classifyProjectDocPath("specs/slices/DEMO-015/test-plan.md")).toBe("task-hub-test-plan");
    expect(classifyProjectDocPath("handovers/2026-04-16-session-abc.md")).toBe("session-handover");
  });

  test("rejects non-canonical project doc paths", () => {
    expect(PROJECT_DIRS).not.toContain("legacy");
    expect(classifyProjectDocPath("legacy/source-inventory.md")).toBeNull();
    expect(isAllowedProjectDocPath("legacy/source-inventory.md")).toBe(false);
    expect(isAllowedProjectDocPath("notes/random.md")).toBe(false);
    expect(isAllowedProjectDocPath("specs/random.md")).toBe(false);
    expect(isAllowedProjectDocPath("specs/demo-015/index.md")).toBe(false);
    expect(isAllowedProjectDocPath("modules/auth/notes.md")).toBe(false);
  });
});

describe("research structure contract", () => {
  test("allows global and project-scoped research paths", () => {
    expect(classifyResearchPath("research/wiki-forge/_overview.md")).toBe("topic-overview");
    expect(classifyResearchPath("research/wiki-forge/spec-ia.md")).toBe("research-page");
    expect(classifyResearchPath("projects/wiki-forge/research/auth-refactor/_overview.md")).toBe("topic-overview");
    expect(classifyResearchPath("projects/wiki-forge/research/auth-refactor/spec-ia.md")).toBe("research-page");
    expect(classifyResearchPath("research/agents/_overview.md")).toBe("topic-overview");
  });

  test("rejects research/projects legacy compatibility paths", () => {
    expect(classifyResearchPath("research/projects/wiki-forge/_overview.md")).toBeNull();
    expect(classifyResearchPath("research/projects/wiki-forge/spec-ia.md")).toBeNull();
    expect(describeAllowedResearchPaths()).not.toContain("legacy");
    expect(describeAllowedResearchPaths()).toContain("projects/<project>/research/<topic>");
  });

  test("normalizes project research refs without global research prefixing", () => {
    expect(normalizeResearchPageRef("projects/wiki-forge/research/runtime-audit/findings")).toBe("projects/wiki-forge/research/runtime-audit/findings");
    expect(normalizeResearchPageRef("research/cross-project-topic/findings")).toBe("research/cross-project-topic/findings");
    expect(normalizeResearchPageRef("cross-project-topic/findings")).toBe("research/cross-project-topic/findings");
    expect(normalizeResearchPageRef("research/projects/wiki-forge/runtime-audit/findings")).toBeNull();
  });

  test("allows canonical raw buckets only", () => {
    expect(classifyRawPath("raw/articles/example.md")).toBe("raw-file");
    expect(classifyRawPath("raw/conversations/chat.txt")).toBe("raw-file");
    expect(isAllowedRawBucket("papers")).toBe(true);
    expect(isAllowedRawBucket("books")).toBe(false);
    expect(classifyRawPath("raw/books/note.md")).toBeNull();
  });
});
