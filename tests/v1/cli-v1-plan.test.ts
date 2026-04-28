import { afterEach, describe, expect, test } from "bun:test";
import matter from "gray-matter";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { describeLegacyCommand } from "../../src/v1/cli/legacy-compat";
import { shouldUseV1ForgePlan } from "../../src/v1/cli/cutover";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

describe("V1 forge plan", () => {
  test("explicit V1 plan returns a gated planning-session packet instead of scaffolding", () => {
    const vault = tempDir("wiki-v1-plan-vault");
    initVault(vault);

    const result = runWiki(["v1", "forge", "plan", "demo", "safer deployment flow", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "blocked",
      project: "demo",
      featureName: "safer deployment flow",
      gate: "planning-session-required",
      canCreatePrd: false,
      canCreateSlices: false,
      requiredSequence: ["torpathy", "domain-model", "grill-prd", "write-prd", "prd-to-slices"],
      requiredSkills: ["torpathy", "domain-model", "grill-me", "write-a-prd", "prd-to-slices"],
      supportsMultiplePrds: true,
      missing: ["torpathy-answer", "domain-model-answer", "prd-candidate", "prd-grill", "slice-breakdown"],
      session: null,
      nextQuestion: {
        id: "plan-scope-boundary",
        skill: "domain-model",
        question: "What precise user-visible outcome should the first PRD under this feature deliver, and what is explicitly out of scope?",
        recommendation: "Define one narrow PRD outcome first, record the terms/decisions in the domain model, then grill that PRD before creating slices.",
      },
      recovery: [
        {
          command: "Start a Torpathy + domain-model planning session for demo",
          description: "Resolve the feature boundary, terminology, and ownership before PRD creation.",
        },
        {
          command: "Run one grill session per PRD candidate",
          description: "A feature may contain multiple PRDs, but each PRD needs its own challenged scope and acceptance criteria.",
        },
        {
          command: "Create PRD(s), then decompose approved PRD(s) into slices",
          description: "Do not create implementation slices until the relevant PRD session is complete.",
        },
      ],
    });
    expect(existsSync(join(vault, "projects", "demo", "forge", "features"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "forge", "prds"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "forge", "slices"))).toBe(false);
  });

  test("default legacy forge plan routes to the same V1 gate and ignores --legacy", () => {
    const vault = tempDir("wiki-v1-plan-legacy-vault");
    initVault(vault);

    const result = runWiki(["forge", "plan", "demo", "new onboarding", "--legacy", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "blocked",
      gate: "planning-session-required",
      featureName: "new onboarding",
      requiredSkills: ["torpathy", "domain-model", "grill-me", "write-a-prd", "prd-to-slices"],
    });
    expect(existsSync(join(vault, "projects", "demo", "forge", "slices"))).toBe(false);
  });

  test("persists planning-session answers and blocks completion until every PRD is grilled and sliced", () => {
    const vault = tempDir("wiki-v1-plan-session-vault");
    initVault(vault);

    const torpathy = runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--answer", "torpathy-boundary", "--skill", "torpathy", "--response", "Runtime contract owns the gate", "--json"], { vault });
    expect(torpathy.exitCode).toBe(0);
    expect(torpathy.json()).toMatchObject({ status: "recorded", session: { status: "draft", answers: [{ skill: "torpathy" }] } });

    expect(runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--answer", "domain-language", "--skill", "domain-model", "--response", "Planning session is canonical lifecycle input", "--json"], { vault }).exitCode).toBe(0);
    expect(runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--prd", "Deployment safety PRD", "--json"], { vault }).exitCode).toBe(0);

    const incomplete = runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--complete-session", "--json"], { vault });
    expect(incomplete.exitCode).toBe(1);
    expect(incomplete.json()).toMatchObject({ status: "blocked", missing: ["prd-grill:Deployment safety PRD", "slice-breakdown:Deployment safety PRD"] });

    expect(runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--answer", "grill-deploy", "--skill", "grill-me", "--prd", "Deployment safety PRD", "--response", "Scope is only the first deployment gate", "--json"], { vault }).exitCode).toBe(0);
    expect(runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--prd", "Deployment safety PRD", "--slice", "Block unsafe deploy until checks pass", "--json"], { vault }).exitCode).toBe(0);

    const complete = runWiki(["v1", "forge", "plan", "demo", "safer deploy", "--complete-session", "--json"], { vault });
    expect(complete.exitCode).toBe(0);
    expect(complete.json()).toMatchObject({ status: "ready-for-artifacts", session: { status: "ready-for-artifacts" } });

    const sessionPath = join(vault, "projects", "demo", "forge", "sessions", "safer-deploy.md");
    const sessionDoc = matter(readFileSync(sessionPath, "utf8"));
    expect(sessionDoc.data.status).toBe("ready-for-artifacts");
    expect(sessionDoc.data.answers.map((answer: { skill: string }) => answer.skill)).toEqual(["torpathy", "domain-model", "grill-me"]);
  });

  test("creates feature PRD and slices only after the planning session is complete", () => {
    const vault = tempDir("wiki-v1-plan-artifacts-vault");
    initVault(vault);

    const base = ["v1", "forge", "plan", "demo", "safer deploy"];
    expect(runWiki([...base, "--answer", "torpathy-boundary", "--skill", "torpathy", "--response", "Runtime contract owns the gate"], { vault }).exitCode).toBe(0);
    expect(runWiki([...base, "--answer", "domain-language", "--skill", "domain-model", "--response", "Planning session is canonical lifecycle input"], { vault }).exitCode).toBe(0);
    expect(runWiki([...base, "--prd", "Deployment safety PRD"], { vault }).exitCode).toBe(0);
    expect(runWiki([...base, "--answer", "grill-deploy", "--skill", "grill-me", "--prd", "Deployment safety PRD", "--response", "Scope is only the first deployment gate"], { vault }).exitCode).toBe(0);
    expect(runWiki([...base, "--prd", "Deployment safety PRD", "--slice", "Block unsafe deploy until checks pass"], { vault }).exitCode).toBe(0);

    const blockedCreate = runWiki([...base, "--create-artifacts", "--json"], { vault });
    expect(blockedCreate.exitCode).toBe(1);
    expect(blockedCreate.stderr.toString()).toContain("planning session is not complete");
    expect(existsSync(join(vault, "projects", "demo", "forge", "features"))).toBe(false);

    expect(runWiki([...base, "--complete-session"], { vault }).exitCode).toBe(0);
    const created = runWiki([...base, "--create-artifacts", "--json"], { vault });
    expect(created.exitCode).toBe(0);
    expect(created.json()).toMatchObject({
      status: "created",
      artifacts: { featureId: "FEAT-001", prds: [{ prdId: "PRD-001", name: "Deployment safety PRD", slices: ["DEMO-001"] }] },
    });

    expect(existsSync(join(vault, "projects", "demo", "specs"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "forge", "features", "FEAT-001-safer-deploy.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "forge", "prds", "PRD-001-deployment-safety-prd.md"))).toBe(true);
    const featureMarkdown = readFileSync(join(vault, "projects", "demo", "forge", "features", "FEAT-001-safer-deploy.md"), "utf8");
    expect(featureMarkdown).toContain("## Decisions");
    expect(featureMarkdown).toContain("Planning session is canonical lifecycle input");

    const prdMarkdown = readFileSync(join(vault, "projects", "demo", "forge", "prds", "PRD-001-deployment-safety-prd.md"), "utf8");
    expect(prdMarkdown).toContain("## Domain Terms");
    expect(prdMarkdown).toContain("## Acceptance Criteria");
    expect(prdMarkdown).toContain("## Handover Hints");

    const sliceHub = matter(readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-001", "index.md"), "utf8"));
    expect(sliceHub.data).toMatchObject({ task_id: "DEMO-001", parent_prd: "PRD-001", parent_feature: "FEAT-001", planning_session: "safer-deploy", status: "draft" });
    expect(sliceHub.content).toContain("## User Job");
    expect(sliceHub.content).toContain("## Handover Hints");

    const slicePlan = readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-001", "plan.md"), "utf8");
    expect(slicePlan).toContain("## TDD Plan");
    expect(slicePlan).toContain("## Verification Expectations");

    const testPlan = readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-001", "test-plan.md"), "utf8");
    expect(testPlan).toContain("## Targeted Verification");
  });

  test("resolver and compatibility metadata declare V1 ownership", () => {
    expect(resolveWikiCommand(["v1", "forge", "plan", "demo", "feature"])).toEqual({
      command: "v1:forge:plan",
      args: ["demo", "feature"],
    });
    expect(shouldUseV1ForgePlan(["demo", "feature", "--legacy"])).toBe(true);
    expect(describeLegacyCommand("wiki forge plan")).toEqual({
      command: "wiki forge plan",
      status: "v1-owned",
      replacement: "wiki v1 forge plan",
      reason: "V1-owned command; no legacy fallback",
    });
  });
});
