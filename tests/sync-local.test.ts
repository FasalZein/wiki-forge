import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSyncPlan, auditInstalledRepoSkills, COMPANION_SKILLS, listRepoSkills, parseSyncArgs, REPO_SKILLS } from "../scripts/sync-local";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("sync-local", () => {
  test("builds the default local sync plan", () => {
    const repoDir = process.cwd();
    const plan = buildSyncPlan({ repoDir, includeCompanions: false, audit: false });
    const repoSkillSteps = plan.slice(3);
    expect(plan.map((step) => step.label)).toEqual([
      "link wiki cli",
      "install latest qmd",
      "rebuild qmd native modules",
      ...REPO_SKILLS.map((skill) => `install repo skill ${skill}`),
    ]);
    expect(plan[0]?.command).toEqual(["bun", "link"]);
    expect(plan[1]?.command).toEqual(["npm", "install", "-g", "@tobilu/qmd@latest", "--audit=false", "--fund=false"]);
    expect(plan[2]?.command).toEqual(["npm", "rebuild", "-g", "@tobilu/qmd"]);
    expect(plan[3]?.command[3]).toBe(`${repoDir}/skills/${REPO_SKILLS[0]}`);
    expect(repoSkillSteps.every((step) => step.command.includes("-g"))).toBe(true);
    expect(repoSkillSteps.every((step) => !step.command.includes("-y"))).toBe(true);
  });

  test("repo skill discovery is code-driven from skills/*/SKILL.md", () => {
    const discovered = listRepoSkills(process.cwd());
    expect(discovered).toEqual(REPO_SKILLS);
    expect(discovered).toContain("improve-codebase-architecture");
    expect(discovered.every((skill) => !skill.endsWith(".md"))).toBe(true);
  });

  test("companion skills list is empty (all skills are repo-owned)", () => {
    expect(COMPANION_SKILLS).toEqual([]);
    const repoDir = process.cwd();
    const withCompanions = buildSyncPlan({ repoDir, includeCompanions: true, audit: false });
    const without = buildSyncPlan({ repoDir, includeCompanions: false, audit: false });
    expect(withCompanions.map((s) => s.label)).toEqual(without.map((s) => s.label));
  });

  test("parses with-companions flag", () => {
    expect(parseSyncArgs([], "/repo/wiki-forge")).toEqual({ includeCompanions: false, audit: false, repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--with-companions"], "/repo/wiki-forge")).toEqual({ includeCompanions: true, audit: false, repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--audit"], "/repo/wiki-forge")).toEqual({ includeCompanions: false, audit: true, repoDir: "/repo/wiki-forge" });
  });

  test("audit detects missing and stale installed repo skills", () => {
    const repoDir = tempDir("sync-local-repo");
    const installRoot = tempDir("sync-local-install");

    for (const skill of ["forge", "wiki"]) {
      mkdirSync(join(repoDir, "skills", skill), { recursive: true });
      writeFileSync(join(repoDir, "skills", skill, "SKILL.md"), `# ${skill}\nrepo\n`, "utf8");
    }
    mkdirSync(join(installRoot, "forge"), { recursive: true });
    writeFileSync(join(installRoot, "forge", "SKILL.md"), "# forge\nstale\n", "utf8");

    const audit = auditInstalledRepoSkills({ repoDir }, installRoot);
    expect(audit.ok).toBe(false);
    expect(audit.rows).toEqual([
      { skill: "forge", status: "stale", installedSkillPath: join(installRoot, "forge", "SKILL.md") },
      { skill: "wiki", status: "missing", installedSkillPath: join(installRoot, "wiki", "SKILL.md") },
    ]);

  });
});
