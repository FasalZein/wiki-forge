import { describe, expect, test } from "bun:test";
import { upstreamSkillAuditConfig } from "../../scripts/audit-upstream-skills";

describe("Matt Pocock auxiliary skill parity", () => {
  test("audits every file required by the upstream engineering skills we wrap", () => {
    const audited = upstreamSkillAuditConfig.files.map((file) => file.localPath).sort();

    expect(audited).toEqual([
      "skills/diagnose/SKILL.md",
      "skills/diagnose/scripts/hitl-loop.template.sh",
      "skills/grill-with-docs/ADR-FORMAT.md",
      "skills/grill-with-docs/CONTEXT-FORMAT.md",
      "skills/grill-with-docs/SKILL.md",
      "skills/handover/SKILL.md",
      "skills/improve-codebase-architecture/DEEPENING.md",
      "skills/improve-codebase-architecture/INTERFACE-DESIGN.md",
      "skills/improve-codebase-architecture/LANGUAGE.md",
      "skills/improve-codebase-architecture/SKILL.md",
      "skills/prd-to-slices/SKILL.md",
      "skills/tdd/SKILL.md",
      "skills/tdd/deep-modules.md",
      "skills/tdd/interface-design.md",
      "skills/tdd/mocking.md",
      "skills/tdd/refactoring.md",
      "skills/tdd/tests.md",
      "skills/write-a-prd/SKILL.md",
    ]);

    const auxiliary = upstreamSkillAuditConfig.files.filter((file) => file.auxiliary).map((file) => file.localPath).sort();
    expect(auxiliary).toEqual([
      "skills/diagnose/scripts/hitl-loop.template.sh",
      "skills/grill-with-docs/ADR-FORMAT.md",
      "skills/grill-with-docs/CONTEXT-FORMAT.md",
      "skills/improve-codebase-architecture/DEEPENING.md",
      "skills/improve-codebase-architecture/INTERFACE-DESIGN.md",
      "skills/improve-codebase-architecture/LANGUAGE.md",
      "skills/tdd/deep-modules.md",
      "skills/tdd/interface-design.md",
      "skills/tdd/mocking.md",
      "skills/tdd/refactoring.md",
      "skills/tdd/tests.md",
    ]);
  });
});
