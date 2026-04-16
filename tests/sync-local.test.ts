import { describe, expect, test } from "bun:test";
import { buildSyncPlan, COMPANION_SKILLS, parseSyncArgs, REPO_SKILLS } from "../scripts/sync-local";

describe("sync-local", () => {
  test("builds the default local sync plan", () => {
    const plan = buildSyncPlan({ repoDir: "/repo/wiki-forge", includeCompanions: false });
    expect(plan.map((step) => step.label)).toEqual([
      "link wiki cli",
      "install latest qmd",
      "rebuild qmd native modules",
      ...REPO_SKILLS.map((skill) => `install repo skill ${skill}`),
    ]);
    expect(plan[0]?.command).toEqual(["bun", "link"]);
    expect(plan[1]?.command).toEqual(["npm", "install", "-g", "@tobilu/qmd@latest", "--audit=false", "--fund=false"]);
    expect(plan[2]?.command).toEqual(["npm", "rebuild", "-g", "@tobilu/qmd"]);
    expect(plan[3]?.command[3]).toBe("/repo/wiki-forge/skills/forge");
  });

  test("companion skills list is empty (all skills are repo-owned)", () => {
    expect(COMPANION_SKILLS).toEqual([]);
    const withCompanions = buildSyncPlan({ repoDir: "/repo/wiki-forge", includeCompanions: true });
    const without = buildSyncPlan({ repoDir: "/repo/wiki-forge", includeCompanions: false });
    // With no companion skills, both plans should be identical
    expect(withCompanions.map((s) => s.label)).toEqual(without.map((s) => s.label));
  });

  test("parses with-companions flag", () => {
    expect(parseSyncArgs([], "/repo/wiki-forge")).toEqual({ includeCompanions: false, repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--with-companions"], "/repo/wiki-forge")).toEqual({ includeCompanions: true, repoDir: "/repo/wiki-forge" });
  });
});
