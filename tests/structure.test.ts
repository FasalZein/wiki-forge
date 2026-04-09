import { describe, expect, test } from "bun:test";
import {
  classifyProjectDocPath,
  isAllowedProjectDocPath,
  isCanonicalTaskId,
  projectModuleSpecPath,
  projectOnboardingPlanPath,
  projectPrdPath,
  projectTaskHubPath,
  projectTaskPlanPath,
  projectTaskTestPlanPath,
} from "../src/lib/structure";
import { classifyRawPath, classifyResearchPath, isAllowedRawBucket } from "../src/lib/research";

describe("project path primitives", () => {
  test("build canonical project spec paths", () => {
    expect(projectPrdPath("demo", "auth-flow")).toEndWith("/projects/demo/specs/prds/prd-auth-flow.md");
    expect(projectOnboardingPlanPath("demo")).toEndWith("/projects/demo/specs/onboarding-plan.md");
    expect(projectModuleSpecPath("demo", "auth")).toEndWith("/projects/demo/modules/auth/spec.md");
    expect(projectTaskHubPath("demo", "DEMO-015")).toEndWith("/projects/demo/specs/slices/DEMO-015/index.md");
    expect(projectTaskPlanPath("demo", "DEMO-015")).toEndWith("/projects/demo/specs/slices/DEMO-015/plan.md");
    expect(projectTaskTestPlanPath("demo", "DEMO-015")).toEndWith("/projects/demo/specs/slices/DEMO-015/test-plan.md");
  });

  test("validate canonical task ids", () => {
    expect(isCanonicalTaskId("DEMO-015")).toBe(true);
    expect(isCanonicalTaskId("WIKI-FORGE-015")).toBe(true);
    expect(isCanonicalTaskId("demo-015")).toBe(false);
    expect(isCanonicalTaskId("notes")).toBe(false);
  });
});

describe("project structure contract", () => {
  test("allows current canonical project doc families", () => {
    expect(classifyProjectDocPath("_summary.md")).toBe("project-file");
    expect(classifyProjectDocPath("modules/auth/spec.md")).toBe("module-spec");
    expect(classifyProjectDocPath("architecture/context-map.md")).toBe("freeform-zone-doc");
    expect(classifyProjectDocPath("specs/index.md")).toBe("spec-index");
    expect(classifyProjectDocPath("specs/prds/index.md")).toBe("spec-prds-index");
    expect(classifyProjectDocPath("specs/slices/index.md")).toBe("spec-slices-index");
    expect(classifyProjectDocPath("specs/archive/index.md")).toBe("spec-archive-index");
    expect(classifyProjectDocPath("specs/onboarding-plan.md")).toBe("spec-onboarding-plan");
    expect(classifyProjectDocPath("specs/prds/prd-auth-flow.md")).toBe("spec-prd");
    expect(classifyProjectDocPath("specs/plan-auth-rollout.md")).toBe("spec-plan");
    expect(classifyProjectDocPath("specs/test-plan-auth-rollout.md")).toBe("spec-test-plan");
    expect(classifyProjectDocPath("specs/slices/DEMO-015/index.md")).toBe("task-hub-index");
    expect(classifyProjectDocPath("specs/slices/DEMO-015/plan.md")).toBe("task-hub-plan");
    expect(classifyProjectDocPath("specs/slices/DEMO-015/test-plan.md")).toBe("task-hub-test-plan");
  });

  test("rejects non-canonical project doc paths", () => {
    expect(isAllowedProjectDocPath("notes/random.md")).toBe(false);
    expect(isAllowedProjectDocPath("specs/random.md")).toBe(false);
    expect(isAllowedProjectDocPath("specs/demo-015/index.md")).toBe(false);
    expect(isAllowedProjectDocPath("modules/auth/notes.md")).toBe(false);
  });
});

describe("research structure contract", () => {
  test("allows canonical research topic and page paths", () => {
    expect(classifyResearchPath("research/projects/wiki-forge/_overview.md")).toBe("topic-overview");
    expect(classifyResearchPath("research/projects/wiki-forge/spec-ia.md")).toBe("research-page");
    expect(classifyResearchPath("research/agents/_overview.md")).toBe("topic-overview");
  });

  test("allows canonical raw buckets only", () => {
    expect(classifyRawPath("raw/articles/example.md")).toBe("raw-file");
    expect(classifyRawPath("raw/conversations/chat.txt")).toBe("raw-file");
    expect(isAllowedRawBucket("papers")).toBe(true);
    expect(isAllowedRawBucket("books")).toBe(false);
    expect(classifyRawPath("raw/books/note.md")).toBeNull();
  });
});
