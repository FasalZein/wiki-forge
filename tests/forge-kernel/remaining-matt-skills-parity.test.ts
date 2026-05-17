import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { upstreamSkillAuditConfig } from "../../scripts/audit-upstream-skills";

describe("remaining Matt Pocock engineering skill parity", () => {
  test("installs the remaining upstream engineering skills with auxiliary files", () => {
    const expectedFiles = [
      "skills/diagnose/SKILL.md",
      "skills/diagnose/scripts/hitl-loop.template.sh",
      "skills/prototype/SKILL.md",
      "skills/prototype/LOGIC.md",
      "skills/prototype/UI.md",
      "skills/triage/SKILL.md",
      "skills/triage/AGENT-BRIEF.md",
      "skills/triage/OUT-OF-SCOPE.md",
      "skills/zoom-out/SKILL.md",
      "skills/setup-matt-pocock-skills/SKILL.md",
      "skills/setup-matt-pocock-skills/domain.md",
      "skills/setup-matt-pocock-skills/issue-tracker-github.md",
      "skills/setup-matt-pocock-skills/issue-tracker-gitlab.md",
      "skills/setup-matt-pocock-skills/issue-tracker-local.md",
      "skills/setup-matt-pocock-skills/triage-labels.md",
    ];

    for (const file of expectedFiles) expect(existsSync(file), file).toBe(true);
  });

  test("uses Wiki/Forge adapters without replacing the upstream workflow", () => {
    expect(readFileSync("skills/diagnose/SKILL.md", "utf8")).toContain("Phase 1 — Build a feedback loop");
    expect(readFileSync("skills/prototype/SKILL.md", "utf8")).toContain("A prototype is **throwaway code that answers a question**");
    expect(readFileSync("skills/triage/SKILL.md", "utf8")).toContain("Every triaged issue should carry exactly one category role and one state role");
    expect(readFileSync("skills/setup-matt-pocock-skills/SKILL.md", "utf8")).toContain("For wiki-forge projects, do not overwrite wiki-owned `AGENTS.md` orientation blocks");
    expect(readFileSync("skills/zoom-out/SKILL.md", "utf8")).toContain("Go up a layer of abstraction");
  });

  test("drift audit covers every Matt engineering skill we now wrap", () => {
    const localPaths = upstreamSkillAuditConfig.files.map((file) => file.localPath);

    expect(localPaths).toContain("skills/diagnose/SKILL.md");
    expect(localPaths).toContain("skills/diagnose/scripts/hitl-loop.template.sh");
    expect(localPaths).toContain("skills/prototype/SKILL.md");
    expect(localPaths).toContain("skills/prototype/LOGIC.md");
    expect(localPaths).toContain("skills/prototype/UI.md");
    expect(localPaths).toContain("skills/triage/SKILL.md");
    expect(localPaths).toContain("skills/triage/AGENT-BRIEF.md");
    expect(localPaths).toContain("skills/triage/OUT-OF-SCOPE.md");
    expect(localPaths).toContain("skills/zoom-out/SKILL.md");
    expect(localPaths).toContain("skills/setup-matt-pocock-skills/SKILL.md");
    expect(upstreamSkillAuditConfig.intentionallyUnmappedUpstreamSkills).toEqual([]);
  });
});
