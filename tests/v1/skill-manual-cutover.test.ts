import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const skill = (name: string) => readFileSync(`skills/${name}/SKILL.md`, "utf8");

describe("skill manuals after legacy cutover", () => {
  test("Forge skill names the stable lifecycle chain and rejects legacy commands", () => {
    const forge = skill("forge");
    expect(forge).toContain("wiki forge plan");
    expect(forge).toContain("wiki forge run");
    expect(forge).toContain("research -> domain-model -> spec -> slices -> ownership -> implementation -> tdd -> verification -> review -> close");
    expect(forge).toContain("Removed legacy commands are not part of the workflow surface");
    expect(forge).toContain("do not use `wiki create-issue-slice`");
  });

  test("Wiki skill treats old lifecycle commands as quarantined, not active tools", () => {
    const wiki = skill("wiki");
    expect(wiki).toContain("Wiki remembers; Forge executes lifecycle.");
    expect(wiki).toContain("Tracked implementation closes through `wiki forge run`");
    expect(wiki).toContain("Do not use or advertise removed legacy lifecycle commands");
    expect(wiki).not.toContain("Closeout/gate review: `wiki closeout");
  });

  test("PRD and slicing skills route artifact creation through Forge planning", () => {
    const prd = skill("write-a-prd");
    const slices = skill("prd-to-slices");
    expect(prd).toContain("`wiki forge plan` owns feature/PRD/slice artifact creation");
    expect(prd).toContain("Do not use legacy PRD commands");
    expect(slices).toContain("wiki forge plan <project> <feature-name> --repo <path>");
    expect(slices).toContain("Do not use removed legacy lifecycle commands");
    expect(slices).not.toContain("wiki create-issue-slice <project> <title>");
  });

  test("TDD skill records evidence through Forge instead of legacy verify-slice", () => {
    const tdd = skill("tdd");
    expect(tdd).toContain("wiki forge evidence <project> <slice> verify");
    expect(tdd).toContain("Do not use removed legacy commands");
    expect(tdd).not.toContain("Run slice verification: `wiki verify-slice");
  });
});
