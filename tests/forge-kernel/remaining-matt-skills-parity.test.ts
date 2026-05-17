import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { upstreamSkillAuditConfig } from "../../scripts/audit-upstream-skills";

describe("remaining Matt Pocock skill parity", () => {
  test("keeps the installed core Matt-derived skills and handoff skill present", () => {
    const expectedFiles = [
      "skills/diagnose/SKILL.md",
      "skills/diagnose/scripts/hitl-loop.template.sh",
      "skills/handoff/SKILL.md",
    ];

    for (const file of expectedFiles) expect(existsSync(file), file).toBe(true);
  });

  test("uses Wiki/Forge adapters without replacing the upstream workflow", () => {
    expect(readFileSync("skills/diagnose/SKILL.md", "utf8")).toContain("Phase 1 — Build a feedback loop");
    expect(readFileSync("skills/handoff/SKILL.md", "utf8")).toContain("wiki handover");
    expect(readFileSync("skills/handoff/SKILL.md", "utf8")).toContain("Do not reconstruct the prior conversation");
  });

  test("drift audit covers every installed Matt-derived skill we wrap", () => {
    const localPaths = upstreamSkillAuditConfig.files.map((file) => file.localPath);

    expect(localPaths).toContain("skills/diagnose/SKILL.md");
    expect(localPaths).toContain("skills/diagnose/scripts/hitl-loop.template.sh");
    expect(localPaths).toContain("skills/handoff/SKILL.md");
    expect(upstreamSkillAuditConfig.intentionallyUnmappedUpstreamSkills).toEqual([]);
  });
});
