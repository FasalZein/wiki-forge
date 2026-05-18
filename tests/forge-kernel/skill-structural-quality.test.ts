import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SKILL_NAMES = [
  "wiki",
  "forge",
  "tdd",
  "diagnose",
  "grill-with-docs",
  "improve-codebase-architecture",
  "write-a-prd",
  "prd-to-slices",
  "handover",
] as const;

const SESSION_CONTEXT_HEADING = "## Wiki/Forge session context";
const FORGE_INTEGRATION_HEADING = "## Forge integration";

function readSkill(name: string): string {
  return readFileSync(`skills/${name}/SKILL.md`, "utf8");
}

function frontmatter(skill: string): string {
  const match = skill.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("skill is missing frontmatter");
  return match[1];
}

function description(skill: string): string {
  const yaml = frontmatter(skill);
  const singleLine = yaml.match(/^description:\s*(.+)$/m)?.[1];
  if (singleLine && singleLine.trim() !== ">") return singleLine.replace(/^"|"$/g, "").trim();

  const block = yaml.match(/^description:\s*>\n([\s\S]*?)(?:\n[a-zA-Z_-]+:|$)/m)?.[1] ?? "";
  return block.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
}

function bodyWithoutFrontmatterAndSessionContext(skill: string): string {
  const withoutFrontmatter = skill.replace(/^---\n[\s\S]*?\n---\n+/, "");
  const sessionStart = withoutFrontmatter.indexOf(SESSION_CONTEXT_HEADING);
  if (sessionStart < 0) return withoutFrontmatter;

  const beforeSession = withoutFrontmatter.slice(0, sessionStart);
  const nextHeading = withoutFrontmatter.indexOf("\n# ", sessionStart);
  if (nextHeading < 0) return beforeSession;
  return beforeSession + withoutFrontmatter.slice(nextHeading + 1);
}

function sectionLines(skill: string, heading: string): readonly string[] {
  const start = skill.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const lines = skill.slice(start).split("\n").slice(1);
  const body: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) break;
    if (line.trim()) body.push(line);
  }
  return body;
}

function hasCompletionChaining(skill: string): boolean {
  return /\*\*After .+ completes:\*\*/.test(skill);
}

describe("skill structural quality", () => {
  test.each(SKILL_NAMES)("%s keeps trigger metadata and manual structure tight", (name) => {
    const skill = readSkill(name);
    const trigger = description(skill);
    const bodyLines = bodyWithoutFrontmatterAndSessionContext(skill)
      .split("\n")
      .filter((line) => line.trim().length > 0);

    expect(trigger.length).toBeLessThanOrEqual(200);
    expect(trigger).toContain("Use when");
    expect(trigger).toMatch(/Use when .+\./);
    expect(bodyLines.length).toBeLessThanOrEqual(100);
    expect(skill).not.toContain("/setup-matt-pocock-skills");
    expect(skill).not.toMatch(/issue tracker/i);
    expect(skill).not.toContain("removed legacy");
    expect(skill).not.toContain("absent from the runtime");
    expect(skill).not.toContain("## Wiki/Forge adapter");
    expect(sectionLines(skill, FORGE_INTEGRATION_HEADING).length).toBeLessThanOrEqual(5);
  });

  test("skills with follow-on workflow name the next Forge step", () => {
    for (const name of ["tdd", "diagnose", "grill-with-docs", "improve-codebase-architecture", "write-a-prd", "prd-to-slices", "handover"] as const) {
      const skill = readSkill(name);
      expect(hasCompletionChaining(skill)).toBe(true);
      expect(skill).toContain("wiki forge next");
    }
  });
});
