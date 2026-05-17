import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditUpstreamSkillDrift, upstreamSkillAuditConfig } from "../../scripts/audit-upstream-skills";

describe("upstream skill drift audit", () => {
  test("checks Matt Pocock workflow skills against preserved upstream anchors", () => {
    expect(upstreamSkillAuditConfig.upstreamRoot).toBe("/Users/tothemoon/Dev/AI/Skills/mattpocock-skills");

    const audited = upstreamSkillAuditConfig.files.map((file) => file.localPath);
    expect(audited).toContain("skills/tdd/SKILL.md");
    expect(audited).toContain("skills/grill-with-docs/SKILL.md");
    expect(audited).toContain("skills/improve-codebase-architecture/SKILL.md");
    expect(audited).toContain("skills/diagnose/SKILL.md");
    expect(audited).toContain("skills/write-a-prd/SKILL.md");
    expect(audited).toContain("skills/prd-to-slices/SKILL.md");
    expect(audited).toContain("skills/handoff/SKILL.md");

    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["audit:upstream-skills"]).toBe("bun scripts/audit-upstream-skills.ts");

    const result = auditUpstreamSkillDrift({ repoRoot: process.cwd() });

    expect(result.ok).toBe(true);
    expect(result.checkedFiles).toBe(18);
    expect(result.failures).toEqual([]);
    expect(result.files.find((file) => file.localPath === "skills/tdd/SKILL.md")?.requiredAnchors).toContain(
      "DO NOT write all tests first, then all implementation",
    );
    expect(result.files.find((file) => file.localPath === "skills/grill-with-docs/SKILL.md")?.requiredAnchors).toContain(
      "Ask the questions one at a time",
    );
    expect(result.files.find((file) => file.localPath === "skills/grill-with-docs/CONTEXT-FORMAT.md")?.requiredAnchors).toContain(
      "Do not force large projects into one giant glossary file",
    );
    expect(result.files.find((file) => file.localPath === "skills/grill-with-docs/ADR-FORMAT.md")?.requiredAnchors).toContain(
      "For wiki-forge projects, ADR bodies live in `projects/<project>/adrs/`",
    );
    expect(result.files.find((file) => file.localPath === "skills/improve-codebase-architecture/SKILL.md")?.requiredAnchors).toContain(
      "Do NOT propose interfaces yet",
    );
    expect(result.files.find((file) => file.localPath === "skills/handoff/SKILL.md")?.requiredAnchors).toEqual([
      "Compact the current conversation into a handoff document for another agent to pick up",
      "Suggest the skills to be used, if any, by the next session",
      "Do not duplicate content already captured in other artifacts",
      "treat them as a description of what the next session will focus on",
    ]);
  });

  test("only explicitly adapted skill manuals may rely on anchors instead of full upstream preservation", () => {
    const adapted = upstreamSkillAuditConfig.files
      .filter((file) => file.preserveMode === "anchors")
      .map((file) => file.localPath)
      .sort();

    expect(adapted).toEqual([
      "skills/diagnose/SKILL.md",
      "skills/grill-with-docs/SKILL.md",
      "skills/handoff/SKILL.md",
      "skills/improve-codebase-architecture/SKILL.md",
      "skills/prd-to-slices/SKILL.md",
      "skills/tdd/SKILL.md",
      "skills/write-a-prd/SKILL.md",
    ]);
    expect(upstreamSkillAuditConfig.files.filter((file) => file.auxiliary).every((file) => file.preserveMode !== "anchors")).toBe(true);
  });
});
