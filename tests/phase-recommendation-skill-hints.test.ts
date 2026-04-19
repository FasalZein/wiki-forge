import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { phaseRecommendation } from "../src/lib/forge-phase-commands";
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
