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

describe("project path primitives", () => {
  test("build canonical project spec paths", () => {
    expect(projectPrdPath("demo", "auth-flow")).toEndWith("/projects/demo/specs/prd-auth-flow.md");
    expect(projectOnboardingPlanPath("demo")).toEndWith("/projects/demo/specs/onboarding-plan.md");
    expect(projectModuleSpecPath("demo", "auth")).toEndWith("/projects/demo/modules/auth/spec.md");
    expect(projectTaskHubPath("demo", "DEMO-015")).toEndWith("/projects/demo/specs/DEMO-015/index.md");
    expect(projectTaskPlanPath("demo", "DEMO-015")).toEndWith("/projects/demo/specs/DEMO-015/plan.md");
    expect(projectTaskTestPlanPath("demo", "DEMO-015")).toEndWith("/projects/demo/specs/DEMO-015/test-plan.md");
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
    expect(classifyProjectDocPath("specs/onboarding-plan.md")).toBe("spec-onboarding-plan");
    expect(classifyProjectDocPath("specs/prd-auth-flow.md")).toBe("spec-prd");
    expect(classifyProjectDocPath("specs/plan-auth-rollout.md")).toBe("spec-plan");
    expect(classifyProjectDocPath("specs/test-plan-auth-rollout.md")).toBe("spec-test-plan");
    expect(classifyProjectDocPath("specs/DEMO-015/index.md")).toBe("task-hub-index");
    expect(classifyProjectDocPath("specs/DEMO-015/plan.md")).toBe("task-hub-plan");
    expect(classifyProjectDocPath("specs/DEMO-015/test-plan.md")).toBe("task-hub-test-plan");
  });

  test("rejects non-canonical project doc paths", () => {
    expect(isAllowedProjectDocPath("notes/random.md")).toBe(false);
    expect(isAllowedProjectDocPath("specs/random.md")).toBe(false);
    expect(isAllowedProjectDocPath("specs/demo-015/index.md")).toBe(false);
    expect(isAllowedProjectDocPath("modules/auth/notes.md")).toBe(false);
  });
});
