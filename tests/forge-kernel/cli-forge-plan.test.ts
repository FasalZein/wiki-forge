import { afterEach, describe, expect, test } from "bun:test";
import matter from "gray-matter";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveForgeCommand } from "../../src/forge";
import { createPlanningSessionAggregate } from "../../src/forge/vault/planning-session-aggregate";
import { writePlanningArtifacts } from "../../src/forge/vault/planning-artifact-writer";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

describe("Forge plan", () => {
  test("explicit Forge plan returns a single Plan-phase packet instead of scaffolding", () => {
    const vault = tempDir("wiki-plan-vault");
    initVault(vault);

    const result = runWiki(["forge", "plan", "demo", "safer deployment flow", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "blocked",
      project: "demo",
      featureName: "safer deployment flow",
      gate: "planning-session-required",
      canCreatePrd: false,
      canCreateSlices: false,
      requiredSequence: ["plan", "prd-candidate", "slice-breakdown"],
      requiredSkills: ["forge", "grill-with-docs", "write-a-prd", "prd-to-slices"],
      phasePacket: {
        kind: "phase-skill-packet",
        phase: "plan",
        requiredSkills: ["grill-with-docs", "forge"],
        requiredOutputs: expect.arrayContaining(["resolved context and decisions", "feature", "PRD", "slices"]),
      },
      supportsMultiplePrds: true,
      missing: ["plan-answer", "prd-candidate", "slice-breakdown"],
      session: null,
      nextQuestion: {
        id: "plan-scope-boundary",
        skill: "plan",
        question: "What precise user-visible outcome should the first PRD under this feature deliver, and what is explicitly out of scope?",
        recommendation: "Answer once with the user-visible outcome, non-goals, context/decisions, PRD acceptance criteria, and initial slice breakdown; Forge will fan that plan into wiki/Forge artifacts.",
      },
      recovery: [
        {
          command: "wiki forge plan demo \"safer deployment flow\" --plan-answer-file <path>",
          description: "Record one plan packet covering outcome, non-goals, context/decisions, PRD criteria, and slice breakdown.",
        },
        {
          command: "wiki forge plan demo \"safer deployment flow\" --prd <name> --slice <title>",
          description: "Add PRD and slice candidates from the same plan packet; repeat --slice for thin tracer bullets.",
        },
        {
          command: "wiki forge plan demo \"safer deployment flow\" --complete-session && wiki forge plan demo \"safer deployment flow\" --create-artifacts",
          description: "Complete and create artifacts after the one Plan packet has PRD and slice candidates.",
        },
      ],
    });
    expect(existsSync(join(vault, "projects", "demo", "forge", "features"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "forge", "prds"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "forge", "slices"))).toBe(false);
  });

  test("removed plan flag routes to the same Forge gate", () => {
    const vault = tempDir("wiki-plan-removed-vault");
    initVault(vault);

    const result = runWiki(["forge", "plan", "demo", "new onboarding", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "blocked",
      gate: "planning-session-required",
      featureName: "new onboarding",
      requiredSkills: ["forge", "grill-with-docs", "write-a-prd", "prd-to-slices"],
    });
    expect(existsSync(join(vault, "projects", "demo", "forge", "slices"))).toBe(false);
  });

  test("persists one Plan answer and blocks completion until every PRD is sliced", () => {
    const vault = tempDir("wiki-plan-session-vault");
    initVault(vault);

    const plan = runWiki(["forge", "plan", "demo", "safer deploy", "--answer", "plan", "--skill", "plan", "--response", "Runtime contract owns the gate", "--json"], { vault });
    expect(plan.exitCode).toBe(0);
    expect(plan.json()).toMatchObject({ status: "recorded", session: { status: "draft", answers: [{ skill: "plan" }] } });

    expect(runWiki(["forge", "plan", "demo", "safer deploy", "--prd", "Deployment safety PRD", "--json"], { vault }).exitCode).toBe(0);

    const incomplete = runWiki(["forge", "plan", "demo", "safer deploy", "--complete-session", "--json"], { vault });
    expect(incomplete.exitCode).toBe(1);
    expect(incomplete.json()).toMatchObject({ status: "blocked", missing: ["slice-breakdown:Deployment safety PRD"] });

    expect(runWiki(["forge", "plan", "demo", "safer deploy", "--prd", "Deployment safety PRD", "--slice", "Block unsafe deploy until checks pass", "--json"], { vault }).exitCode).toBe(0);

    const complete = runWiki(["forge", "plan", "demo", "safer deploy", "--complete-session", "--json"], { vault });
    expect(complete.exitCode).toBe(0);
    expect(complete.json()).toMatchObject({ status: "ready-for-artifacts", session: { status: "ready-for-artifacts" } });

    const sessionPath = join(vault, "projects", "demo", "forge", "sessions", "safer-deploy.md");
    const sessionDoc = matter(readFileSync(sessionPath, "utf8"));
    expect(sessionDoc.data.status).toBe("ready-for-artifacts");
    expect(sessionDoc.data.answers.map((answer: { skill: string }) => answer.skill)).toEqual(["plan"]);
  });

  test("records multiline Plan answers from files without shell heredocs", () => {
    const vault = tempDir("wiki-plan-answer-file-vault");
    initVault(vault);
    const answerPath = join(vault, "plan-answer.md");
    writeFileSync(answerPath, "Outcome line one\n\n- explicit non-goal\n", "utf8");

    const result = runWiki(["forge", "plan", "demo", "financial metrics", "--plan-answer-file", answerPath, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "recorded",
      session: {
        featureName: "financial metrics",
        answers: [{ skill: "plan", response: "Outcome line one\n\n- explicit non-goal\n" }],
      },
    });
  });

  test("keeps convenience answer values out of the feature name", () => {
    const vault = tempDir("wiki-plan-inline-answer-vault");
    initVault(vault);

    const result = runWiki(["forge", "plan", "demo", "financial metrics", "--plan-answer", "Outcome must be server-owned metrics", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "recorded",
      session: {
        featureName: "financial metrics",
        answers: [{ skill: "plan", response: "Outcome must be server-owned metrics" }],
      },
    });
  });

  test("rejects unknown planning flags instead of folding their values into the feature name", () => {
    const vault = tempDir("wiki-plan-unknown-flag-vault");
    initVault(vault);

    const result = runWiki(["forge", "plan", "demo", "financial metrics", "--typo-answer", "do not become feature name", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown forge plan option: --typo-answer");
  });

  test("accepts legacy domain-model answers as grill-with-docs answers", () => {
    const vault = tempDir("wiki-plan-legacy-domain-vault");
    initVault(vault);

    const result = runWiki(["forge", "plan", "demo", "safer deploy", "--answer", "domain-language", "--skill", "domain-model", "--response", "Legacy answer is normalized", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "recorded", session: { answers: [{ skill: "grill-with-docs" }] } });
  });

  test("planning artifact writer creates feature, PRD, and slice docs", async () => {
    const vault = tempDir("wiki-planning-writer-vault");
    initVault(vault);
    const aggregate = createPlanningSessionAggregate({ project: "demo", featureName: "safer deploy", vaultRoot: vault });
    await aggregate.recordPlan({ response: "Runtime contract owns the gate." });
    await aggregate.addPrd("Deployment safety PRD");
    await aggregate.addSlice("Deployment safety PRD", "Block unsafe deploy until checks pass");
    const { session } = await aggregate.complete();

    const artifacts = await writePlanningArtifacts({
      vaultRoot: vault,
      project: "demo",
      featureName: "safer deploy",
      session,
      now: "2026-05-15T00:00:00.000Z",
    });

    expect(artifacts).toMatchObject({ featureId: "FEAT-001", prds: [{ prdId: "PRD-001", slices: ["DEMO-001"] }] });
    expect(existsSync(join(vault, "projects", "demo", "forge", "features", "FEAT-001-safer-deploy.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "forge", "prds", "PRD-001-deployment-safety-prd.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-001", "index.md"))).toBe(true);

    const inspected = await aggregate.inspect();
    expect(inspected.session?.status).toBe("ready-for-artifacts");
  });

  test("aggregate facade records, completes, inspects, and creates artifacts", async () => {
    const vault = tempDir("wiki-plan-aggregate-vault");
    initVault(vault);
    const aggregate = createPlanningSessionAggregate({ project: "demo", featureName: "safer deploy", vaultRoot: vault });

    const recorded = await aggregate.recordPlan({
      answerId: "plan",
      response: "Runtime contract owns the gate. Planning aggregate is the entrypoint.",
    });
    expect(recorded.status).toBe("draft");
    expect(recorded.answers).toHaveLength(1);

    await aggregate.addPrd("Deployment safety PRD");
    await aggregate.addSlice("Deployment safety PRD", "Block unsafe deploy until checks pass");

    const ready = await aggregate.complete();
    expect(ready.gate).toEqual({ status: "ready", missing: [] });
    expect(ready.session.status).toBe("ready-for-artifacts");

    const artifacts = await aggregate.createArtifacts();
    expect(artifacts.artifacts).toMatchObject({ featureId: "FEAT-001", prds: [{ prdId: "PRD-001", slices: ["DEMO-001"] }] });

    const inspected = await aggregate.inspect();
    expect(inspected.session?.status).toBe("artifacts-created");
    expect(inspected.gate).toEqual({ status: "ready", missing: [] });
  });

  test("keeps legacy prd-grill answers readable without advertising grill-me", () => {
    const vault = tempDir("wiki-plan-legacy-prd-grill-vault");
    initVault(vault);

    const base = ["forge", "plan", "demo", "legacy planning"];
    expect(runWiki([...base, "--plan-answer", "One plan answer"], { vault }).exitCode).toBe(0);
    expect(runWiki([...base, "--prd", "Legacy PRD", "--slice", "Legacy slice"], { vault }).exitCode).toBe(0);
    const legacy = runWiki([...base, "--answer", "prd-grill", "--skill", "grill-me", "--prd", "Legacy PRD", "--response", "Old planning-session note"], { vault });
    expect(legacy.exitCode).toBe(0);

    const complete = runWiki([...base, "--complete-session", "--json"], { vault });
    expect(complete.exitCode).toBe(0);
    expect(complete.json()).toMatchObject({ status: "ready-for-artifacts" });
  });

  test("creates feature PRD and slices after the one Plan answer is complete", () => {
    const vault = tempDir("wiki-plan-artifacts-vault");
    initVault(vault);

    const base = ["forge", "plan", "demo", "safer deploy"];
    expect(runWiki([...base, "--answer", "plan", "--skill", "plan", "--response", "Runtime contract owns the gate. Planning session is canonical lifecycle input"], { vault }).exitCode).toBe(0);
    expect(runWiki([...base, "--prd", "Deployment safety PRD"], { vault }).exitCode).toBe(0);
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

  test("resolver and compatibility metadata declare Forge ownership", () => {
    expect(resolveForgeCommand(["plan", "demo", "feature"])).toEqual({
      command: "forge:plan",
      args: ["demo", "feature"],
    });
  });
});
