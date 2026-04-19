import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { phaseRecommendation } from "../src/lib/forge-phase-commands";
import { buildForgeSteering } from "../src/lib/forge-steering";
import { buildForgeTriage } from "../src/protocol/forge-status";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, runGit, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("phase recommendation skill hints", () => {
  test("phaseRecommendation maps research and verify to explicit skills", () => {
    expect(phaseRecommendation("demo", "DEMO-001", "research").loadSkill).toBe("/research");
    expect(phaseRecommendation("demo", "DEMO-001", "verify").loadSkill).toBe("/desloppify");
  });

  test("domain-model phase recommendation points at wiki-native outputs", () => {
    const recommendation = phaseRecommendation("demo", "DEMO-001", "domain-model");

    expect(recommendation.kind).toBe("needs-domain-model");
    expect(recommendation.loadSkill).toBe("/domain-model");
    expect(recommendation.command).toContain("projects/demo/decisions.md");
    expect(recommendation.command).toContain("projects/demo/architecture/domain-language.md");
  });

  test("pre-prd triage steers domain work through /domain-model", () => {
    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: "DEMO-001",
      sliceStatus: "in-progress",
      section: "In Progress",
      planStatus: "missing",
      testPlanStatus: "missing",
      verificationLevel: null,
      nextPhase: "domain-model",
    });
    const steering = buildForgeSteering({
      project: "demo",
      sliceId: "DEMO-001",
      triage,
      nextPhase: "domain-model",
      planStatus: "missing",
      testPlanStatus: "missing",
      verificationLevel: null,
      sliceStatus: "in-progress",
      section: "In Progress",
    });

    expect(steering.lane).toBe("domain-work");
    expect(steering.loadSkill).toBe("/domain-model");
    expect(steering.nextCommand).toContain("projects/demo/decisions.md");
    expect(steering.nextCommand).toContain("projects/demo/architecture/domain-language.md");
  });

  test("resume surfaces loadSkill in text and json for pre-implementation phases", () => {
    const vault = tempDir("phase-hints-vault");
    const repo = tempDir("phase-hints-repo");
    initVault(vault);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "skillhints"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "skillhints");
    expect(runWiki(["create-issue-slice", "skillhints", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "skillhints", "SKILLHINTS-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const text = runWiki(["resume", "skillhints", "--repo", repo], env);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("load-skill: /research");

    const json = runWiki(["resume", "skillhints", "--repo", repo, "--json"], env);
    expect(json.exitCode).toBe(0);
    expect(json.json<{ triage: { loadSkill?: string } }>().triage.loadSkill).toBe("/research");
  });
});
