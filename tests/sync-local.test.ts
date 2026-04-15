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

  test("adds companion skills only when requested", () => {
    const plan = buildSyncPlan({ repoDir: "/repo/wiki-forge", includeCompanions: true });
    const companionCommands = plan.slice(-COMPANION_SKILLS.length);
    expect(companionCommands.map((step) => step.command[3])).toEqual([...COMPANION_SKILLS]);
  });

  test("parses with-companions flag", () => {
    expect(parseSyncArgs([], "/repo/wiki-forge")).toEqual({ includeCompanions: false, repoDir: "/repo/wiki-forge" });
    expect(parseSyncArgs(["--with-companions"], "/repo/wiki-forge")).toEqual({ includeCompanions: true, repoDir: "/repo/wiki-forge" });
  });
});
