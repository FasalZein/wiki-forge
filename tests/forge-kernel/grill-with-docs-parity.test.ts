import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const skill = () => readFileSync("skills/grill-with-docs/SKILL.md", "utf8");
const contextFormat = () => readFileSync("skills/grill-with-docs/CONTEXT-FORMAT.md", "utf8");
const adrFormat = () => readFileSync("skills/grill-with-docs/ADR-FORMAT.md", "utf8");

describe("grill-with-docs upstream parity", () => {
  test("keeps Matt Pocock structure with only Wiki storage routing added", () => {
    const text = skill();

    expect(text).toContain("<what-to-do>");
    expect(text).toContain("<supporting-info>");
    expect(text).toContain("## Domain awareness");
    expect(text).toContain("## During the session");
    expect(text).toContain("### Challenge against the glossary");
    expect(text).toContain("### Sharpen fuzzy language");
    expect(text).toContain("### Discuss concrete scenarios");
    expect(text).toContain("### Cross-reference with code");
    expect(text).toContain("### Update CONTEXT.md inline");
    expect(text).toContain("### Offer ADRs sparingly");

    expect(text).toContain("Storage mapping is the adapter; the grilling workflow above remains upstream");
    expect(text).toContain("`CONTEXT.md` maps to `projects/<project>/architecture/domain-language.md`");
    expect(text).toContain("`CONTEXT-MAP.md` maps to `projects/<project>/architecture/context-map.md`");
    expect(text).toContain("projects/<project>/architecture/contexts/<context>.md");
    expect(text).toContain("`docs/adr/` maps to `projects/<project>/adrs/` with `projects/<project>/decisions.md` as the index");
  });

  test("documents scalable Wiki context pages instead of a giant context map", () => {
    const text = contextFormat();

    expect(text).toContain("projects/<project>/architecture/context-map.md");
    expect(text).toContain("projects/<project>/architecture/contexts/<context>.md");
    expect(text).toContain("Do not force large projects into one giant glossary file");
    expect(text).toContain("Use `projects/<project>/architecture/domain-language.md` for a single/default context");
  });

  test("keeps ADR behavior while routing bodies and index to Wiki", () => {
    const text = adrFormat();

    expect(text).toContain("ADR bodies live in `projects/<project>/adrs/`");
    expect(text).toContain("`projects/<project>/decisions.md` remains the index");
    expect(text).toContain("An ADR can be a single paragraph");
    expect(text).toContain("Keep the upstream ADR threshold");
  });
});
