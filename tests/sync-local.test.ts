import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertInstalledRepoSkillsFresh, auditInstalledRepoSkills, buildSyncPlan, COMPANION_SKILLS, listRepoSkills, parseSyncArgs, REPO_SKILLS, selectRepoSkills, WIKI_ONLY_SKILLS } from "../scripts/sync-local";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("sync-local", () => {
  test("builds the default local sync plan", () => {
    const repoDir = process.cwd();
    const plan = buildSyncPlan({ repoDir, includeCompanions: false, audit: false, installSet: "full" });
    const repoSkillSteps = plan.slice(3);
    const repoSkillLabels = REPO_SKILLS.flatMap((skill) => [
      `remove repo skill ${skill}`,
      `install repo skill ${skill}`,
    ]);
    expect(plan.map((step) => step.label)).toEqual([
      "link wiki cli",
      "install latest qmd",
      "rebuild qmd native modules",
      ...repoSkillLabels,
    ]);
    expect(plan[0]?.command).toEqual(["bun", "link"]);
    expect(plan[1]?.command).toEqual(["npm", "install", "-g", "@tobilu/qmd@latest", "--audit=false", "--fund=false"]);
    expect(plan[2]?.command).toEqual(["npm", "rebuild", "-g", "@tobilu/qmd"]);
    expect(plan[3]?.command).toEqual(["npx", "skills@latest", "remove", REPO_SKILLS[0]!, "-g", "-y"]);
    expect(plan[4]?.command[3]).toBe(`${repoDir}/skills/${REPO_SKILLS[0]}`);
    expect(repoSkillSteps.every((step) => step.command.includes("-g"))).toBe(true);
    expect(repoSkillSteps.filter((_, index) => index % 2 === 0).every((step) => step.command.includes("-y"))).toBe(true);
    expect(repoSkillSteps.filter((_, index) => index % 2 === 1).every((step) => step.command.includes("-y"))).toBe(true);
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
    const withCompanions = buildSyncPlan({ repoDir, includeCompanions: true, audit: false, installSet: "full" });
    const without = buildSyncPlan({ repoDir, includeCompanions: false, audit: false, installSet: "full" });
    expect(withCompanions.map((s) => s.label)).toEqual(without.map((s) => s.label));
  });

  test("parses install set and with-companions flags", () => {
    expect(parseSyncArgs([], "/repo/wiki-forge")).toEqual({ includeCompanions: false, audit: false, installSet: "full", repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--with-companions"], "/repo/wiki-forge")).toEqual({ includeCompanions: true, audit: false, installSet: "full", repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--audit"], "/repo/wiki-forge")).toEqual({ includeCompanions: false, audit: true, installSet: "full", repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--wiki-only"], "/repo/wiki-forge")).toEqual({ includeCompanions: false, audit: false, installSet: "wiki-only", repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--install-set", "wiki-only"], "/repo/wiki-forge")).toEqual({ includeCompanions: false, audit: false, installSet: "wiki-only", repoDir: "/repo/wiki-forge" });
  });

  test("wiki-only install set narrows repo skill selection to the wiki skill", () => {
    const repoDir = process.cwd();
    expect(selectRepoSkills(repoDir, "wiki-only")).toEqual([...WIKI_ONLY_SKILLS]);
    const plan = buildSyncPlan({ repoDir, includeCompanions: false, audit: false, installSet: "wiki-only" });
    expect(plan.map((step) => step.label)).toEqual([
      "link wiki cli",
      "install latest qmd",
      "rebuild qmd native modules",
      "remove repo skill wiki",
      "install repo skill wiki",
    ]);
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

    const audit = auditInstalledRepoSkills({ repoDir, installSet: "full" }, installRoot);
    expect(audit.ok).toBe(false);
    expect(audit.rows).toEqual([
      { skill: "forge", status: "stale", installedSkillPath: join(installRoot, "forge", "SKILL.md") },
      { skill: "wiki", status: "missing", installedSkillPath: join(installRoot, "wiki", "SKILL.md") },
    ]);

  });

  test("post-install verification fails loudly when repo-owned installed skills stay stale", () => {
    const repoDir = tempDir("sync-local-repo");
    const installRoot = tempDir("sync-local-install");

    for (const skill of ["forge", "wiki"]) {
      mkdirSync(join(repoDir, "skills", skill), { recursive: true });
      writeFileSync(join(repoDir, "skills", skill, "SKILL.md"), `# ${skill}\nrepo\n`, "utf8");
    }
    mkdirSync(join(installRoot, "forge"), { recursive: true });
    mkdirSync(join(installRoot, "wiki"), { recursive: true });
    writeFileSync(join(installRoot, "forge", "SKILL.md"), "# forge\nstale\n", "utf8");
    writeFileSync(join(installRoot, "wiki", "SKILL.md"), "# wiki\nrepo\n", "utf8");

    expect(() => assertInstalledRepoSkillsFresh({ repoDir, installSet: "full" }, installRoot)).toThrow(
      "sync:local finished but installed repo skill copies are still stale under",
    );
    expect(() => assertInstalledRepoSkillsFresh({ repoDir, installSet: "full" }, installRoot)).toThrow("forge: stale");
  });

  test("post-install verification fails when repo-owned installed skills are missing", () => {
    const repoDir = tempDir("sync-local-repo");
    const installRoot = tempDir("sync-local-install");

    for (const skill of ["forge", "wiki"]) {
      mkdirSync(join(repoDir, "skills", skill), { recursive: true });
      writeFileSync(join(repoDir, "skills", skill, "SKILL.md"), `# ${skill}\nrepo\n`, "utf8");
    }
    mkdirSync(join(installRoot, "forge"), { recursive: true });
    writeFileSync(join(installRoot, "forge", "SKILL.md"), "# forge\nrepo\n", "utf8");

    expect(() => assertInstalledRepoSkillsFresh({ repoDir, installSet: "full" }, installRoot)).toThrow("wiki: missing");
  });

  test("post-install verification passes when repo-owned installed skills are fresh", () => {
    const repoDir = tempDir("sync-local-repo");
    const installRoot = tempDir("sync-local-install");

    for (const skill of ["forge", "wiki"]) {
      mkdirSync(join(repoDir, "skills", skill), { recursive: true });
      mkdirSync(join(installRoot, skill), { recursive: true });
      const contents = `# ${skill}\nrepo\n`;
      writeFileSync(join(repoDir, "skills", skill, "SKILL.md"), contents, "utf8");
      writeFileSync(join(installRoot, skill, "SKILL.md"), contents, "utf8");
    }

    expect(assertInstalledRepoSkillsFresh({ repoDir, installSet: "full" }, installRoot).ok).toBe(true);
  });

  test("wiki-only audit ignores missing forge skills", () => {
    const repoDir = tempDir("sync-local-repo");
    const installRoot = tempDir("sync-local-install");

    for (const skill of ["forge", "wiki"]) {
      mkdirSync(join(repoDir, "skills", skill), { recursive: true });
      writeFileSync(join(repoDir, "skills", skill, "SKILL.md"), `# ${skill}\nrepo\n`, "utf8");
    }
    mkdirSync(join(installRoot, "wiki"), { recursive: true });
    writeFileSync(join(installRoot, "wiki", "SKILL.md"), "# wiki\nrepo\n", "utf8");

    const audit = auditInstalledRepoSkills({ repoDir, installSet: "wiki-only" }, installRoot);
    expect(audit.ok).toBe(true);
    expect(audit.rows).toEqual([
      { skill: "wiki", status: "ok", installedSkillPath: join(installRoot, "wiki", "SKILL.md") },
    ]);
  });
});
