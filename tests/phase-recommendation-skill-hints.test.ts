import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { phaseRecommendation } from "../src/protocol/steering/phase-commands";
import { buildForgeSteering } from "../src/protocol/steering/packet";
import { buildForgeTriage } from "../src/protocol";
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

  test("research phase recommendation keeps topic and project separate", () => {
    const recommendation = phaseRecommendation("demo", "DEMO-001", "research");

    expect(recommendation.command).toContain("wiki research file <topic> --project demo <title>");
    expect(recommendation.command).toContain("wiki research bridge <research-page> --project demo --slice DEMO-001");
    expect(recommendation.command).not.toContain("wiki research file demo <title>");
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

  test("resume uses the repo-configured research skill alias", () => {
    const vault = tempDir("phase-hints-config-vault");
    const repo = tempDir("phase-hints-config-repo");
    initVault(vault);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "workflow": { "phaseSkills": { "research": "/custom-research" } } }`, "utf8");
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 2\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "skillcfg"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "skillcfg");
    expect(runWiki(["create-issue-slice", "skillcfg", "auth slice"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "skillcfg", "SKILLCFG-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const text = runWiki(["resume", "skillcfg", "--repo", repo], env);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("load-skill: /custom-research");

    const json = runWiki(["resume", "skillcfg", "--repo", repo, "--json"], env);
    expect(json.exitCode).toBe(0);
    expect(json.json<{ triage: { loadSkill?: string } }>().triage.loadSkill).toBe("/custom-research");
  });

  test("project config can override the surfaced phase skill without code changes", () => {
    const repo = tempDir("phase-skill-config");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "workflow": { "phaseSkills": { "research": "/custom-research", "domainModel": "/custom-domain" } } }`, "utf8");

    const research = phaseRecommendation("demo", "DEMO-001", "research", repo);
    expect(research.loadSkill).toBe("/custom-research");
    expect(research.command).toContain("/custom-research");

    const domainModel = phaseRecommendation("demo", "DEMO-001", "domain-model", repo);
    expect(domainModel.loadSkill).toBe("/custom-domain");
    expect(domainModel.command).toContain("/custom-domain");

    const triage = buildForgeTriage("demo", "DEMO-001", {
      activeSlice: "DEMO-001",
      sliceStatus: "in-progress",
      section: "In Progress",
      planStatus: "missing",
      testPlanStatus: "missing",
      verificationLevel: null,
      nextPhase: "research",
      repo,
    });
    expect(triage.loadSkill).toBe("/custom-research");
  });
});
