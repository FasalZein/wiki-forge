import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { describeLegacyCommand } from "../../src/v1/cli/legacy-compat";
import { shouldUseV1ForgePlan } from "../../src/slice/forge";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

describe("V1 forge plan", () => {
  test("explicit V1 plan returns a gated planning-session packet instead of scaffolding", () => {
    const vault = tempDir("wiki-v1-plan-vault");
    initVault(vault);

    const result = runWiki(["v1", "forge", "plan", "demo", "safer deployment flow", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toEqual({
      status: "blocked",
      project: "demo",
      featureName: "safer deployment flow",
      gate: "planning-session-required",
      canCreatePrd: false,
      canCreateSlices: false,
      requiredSequence: ["torpathy", "domain-model", "grill-prd", "write-prd", "prd-to-slices"],
      requiredSkills: ["torpathy", "domain-model", "grill-me", "write-a-prd", "prd-to-slices"],
      supportsMultiplePrds: true,
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
    expect(existsSync(join(vault, "projects", "demo", "specs", "features"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "specs", "prds"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices"))).toBe(false);
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
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices"))).toBe(false);
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
