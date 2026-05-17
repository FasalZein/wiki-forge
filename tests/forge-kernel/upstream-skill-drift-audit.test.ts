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
    expect(audited).toContain("skills/prototype/SKILL.md");
    expect(audited).toContain("skills/setup-matt-pocock-skills/SKILL.md");
    expect(audited).toContain("skills/triage/SKILL.md");
    expect(audited).toContain("skills/zoom-out/SKILL.md");
    expect(audited).toContain("skills/write-a-prd/SKILL.md");
    expect(audited).toContain("skills/prd-to-slices/SKILL.md");

    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["audit:upstream-skills"]).toBe("bun scripts/audit-upstream-skills.ts");

    const result = auditUpstreamSkillDrift({ repoRoot: process.cwd() });

    expect(result.ok).toBe(true);
    expect(result.checkedFiles).toBe(30);
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
  });
});
