import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const note = () => readFileSync("docs/upstream-skill-adaptation-rules.md", "utf8");

describe("upstream skill alignment notes", () => {
  test("records Matt Pocock upstream sources and Wiki/Forge adapter rules", () => {
    const text = note();

    expect(text).toContain("/Users/tothemoon/Dev/AI/Skills/mattpocock-skills");
    expect(text).toContain("skills/engineering/tdd/SKILL.md");
    expect(text).toContain("skills/engineering/grill-with-docs/SKILL.md");
    expect(text).toContain("skills/engineering/improve-codebase-architecture/SKILL.md");
    expect(text).toContain("skills/engineering/to-prd/SKILL.md");
    expect(text).toContain("skills/engineering/to-issues/SKILL.md");
    expect(text).toContain("public interfaces, not implementation details");
    expect(text).toContain("DO NOT write all tests first, then all implementation");
    expect(text).toContain("Ask the questions one at a time");
    expect(text).toContain("CONTEXT.md → projects/<project>/architecture/domain-language.md");
    expect(text).toContain("docs/adr/ → projects/<project>/adrs/ with `projects/<project>/decisions.md` maintained as the index");
    expect(text).toContain("issue tracker → wiki forge plan");
    expect(text).toContain("TDD evidence → wiki forge tdd cycle");
  });
});
