import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSkillCandidateRewrite } from "../experiments/ax-optimizer/src/skill-guard";
import type { SkillCandidateTarget } from "../experiments/ax-optimizer/src/types";

const ROOT = "/Users/tothemoon/Dev/Code Forge/knowledge-wiki-system";
const AX_DIR = join(ROOT, "experiments", "ax-optimizer");

function read(path: string) {
  return readFileSync(path, "utf8");
}

function loadTarget(skillName: string): SkillCandidateTarget {
  const targets = JSON.parse(read(join(AX_DIR, "targets", "skill-candidates.json"))) as SkillCandidateTarget[];
  const target = targets.find((entry) => entry.skillName === skillName);
  if (!target) throw new Error(`missing target: ${skillName}`);
  return target;
}

describe("AX optimizer skill candidate guard", () => {
  test("accepts the current wiki skill as structurally valid", () => {
    const target = loadTarget("wiki");
    const currentSkill = read(join(ROOT, target.sourcePath));
    const result = validateSkillCandidateRewrite({ currentSkill, revisedSkill: currentSkill, target });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects a single-line collapsed skill rewrite", () => {
    const target = loadTarget("wiki");
    const currentSkill = read(join(ROOT, target.sourcePath));
    const collapsed = currentSkill.replace(/\s*\n+\s*/g, " ").trim();
    const result = validateSkillCandidateRewrite({ currentSkill, revisedSkill: collapsed, target });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("frontmatter"))).toBe(true);
    expect(result.errors.some((error) => error.includes("section structure") || error.includes("line count"))).toBe(true);
  });

  test("rejects missing required phrases and forbidden phrases", () => {
    const target = loadTarget("forge");
    const currentSkill = read(join(ROOT, target.sourcePath));
    const revised = currentSkill
      .replaceAll("wiki research adopt", "wiki research bridge")
      .concat("\nwiki forge run is always the next step\n");
    const result = validateSkillCandidateRewrite({ currentSkill, revisedSkill: revised, target });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing required phrase: wiki research adopt");
    expect(result.errors).toContain("contains forbidden phrase: wiki forge run is always the next step");
  });
});
