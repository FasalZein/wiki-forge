import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const skill = (name: string) => readFileSync(`skills/${name}/SKILL.md`, "utf8");

describe("skill manuals after legacy cutover", () => {
  test("core skills start with Wiki/Forge session context and environment vault orientation", () => {
    const coreSkills = ["wiki", "forge", "grill-with-docs", "write-a-prd", "prd-to-slices", "tdd", "diagnose", "improve-codebase-architecture"];

    for (const name of coreSkills) {
      const manual = skill(name);
      const sessionContextIndex = manual.indexOf("## Wiki/Forge session context");
      const headings = Array.from(manual.matchAll(/^## Wiki\/Forge session context$/gm));

      expect(headings).toHaveLength(1);
      expect(sessionContextIndex).toBeGreaterThan(0);
      expect(sessionContextIndex).toBeLessThan(1500);
      const sessionContext = manual.slice(sessionContextIndex, manual.indexOf("\n# ", sessionContextIndex));

      expect(sessionContext).toContain("KNOWLEDGE_VAULT_ROOT");
      expect(sessionContext).toContain("wiki config --effective --repo <path>");
      expect(sessionContext).not.toContain("/Users/tothemoon/Knowledge");
      expect(sessionContext).not.toContain("~/Knowledge");
      expect(manual).toContain("Forge-tracked use");
      expect(manual).toContain("Standalone use");
      expect(manual).toContain("Do not create durable project memory markdown inside the code repo");
    }
  });

  test("Forge skill names the stable lifecycle chain and rejects legacy commands", () => {
    const forge = skill("forge");
    expect(forge).toContain("wiki forge plan");
    expect(forge).toContain("wiki forge run");
    expect(forge).toContain("forge plan -> build -> TDD/EDD -> verify -> review -> close");
    expect(forge).toContain("Removed legacy commands are not part of the workflow surface");
    expect(forge).toContain("absent from the runtime");
    expect(forge).toContain("Health is the cross-cutting inspector/reconciler");
    expect(forge).toContain("Do not move Health orchestration into shared or lib");
    expect(forge).toContain("File non-overlap alone is not enough");
    expect(forge).toContain("Never work around the active-slice invariant");
  });

  test("Wiki skill treats old lifecycle commands as removed, not active tools", () => {
    const wiki = skill("wiki");
    expect(wiki).toContain("Wiki remembers; Forge executes lifecycle.");
    expect(wiki).toContain("Health inspects and reconciles freshness, drift, repair queues, and readiness gates");
    expect(wiki).toContain("Tracked implementation closes through `wiki forge run`");
    expect(wiki).toContain("absent from the runtime");
    expect(wiki).not.toContain("Closeout/gate review: `wiki closeout");
  });

  test("Wiki and Forge skills trigger on vault and workflow confusion without repo-local folders", () => {
    const wiki = skill("wiki");
    const forge = skill("forge");

    expect(wiki).toContain("knowledge repository");
    expect(wiki).toContain("vault root");
    expect(wiki).toContain("Do not create `projects/`, `wiki/`, or `forge/` folders under the repo");
    expect(wiki).toContain("KNOWLEDGE_VAULT_ROOT");

    expect(forge).toContain("feature/PRD/slice");
    expect(forge).toContain("active slice");
    expect(forge).toContain("wiki forge next");
    expect(forge).toContain("Forge artifacts are vault-owned");
    expect(forge).toContain("Do not create repo-local `forge/`, `wiki/`, or `projects/` folders");
  });

  test("PRD and slicing skills route artifact creation through Forge planning", () => {
    const prd = skill("write-a-prd");
    const slices = skill("prd-to-slices");
    expect(prd).toContain("`wiki forge plan` owns feature/PRD/slice artifact creation");
    expect(prd).toContain("Do not use removed legacy PRD commands");
    expect(slices).toContain("wiki forge plan <project> <feature-name> --repo <path>");
    expect(slices).toContain("absent from the runtime surface");
    expect(slices).toContain("Forge status is workflow truth. Checkpoint/maintain are Health-owned freshness and repair truth. Generated views are projections.");
    expect(slices).not.toContain("wiki create-issue-slice <project> <title>");
  });

  test("Planning and architecture skills preserve upstream context and ADR workflow", () => {
    const grill = skill("grill-with-docs");
    const architecture = skill("improve-codebase-architecture");

    expect(grill).toContain("<what-to-do>");
    expect(grill).toContain("Interview me relentlessly about every aspect of this plan");
    expect(grill).toContain("Ask the questions one at a time, waiting for feedback on each question before continuing");
    expect(grill).toContain("If a question can be answered by exploring the codebase, explore the codebase instead");
    expect(grill).toContain("Update CONTEXT.md inline");
    expect(grill).toContain("CONTEXT.md → projects/<project>/architecture/domain-language.md");
    expect(grill).toContain("docs/adr/ → projects/<project>/adrs/ with projects/<project>/decisions.md as the index");
    expect(grill).toContain("wiki forge grill record <project>");

    expect(architecture).toContain("## Glossary");
    expect(architecture).toContain("Use these terms exactly in every suggestion");
    expect(architecture).toContain("Do NOT propose interfaces yet");
    expect(architecture).toContain("Which of these would you like to explore?");
    expect(architecture).toContain("Side effects happen inline as decisions crystallize");
    expect(architecture).toContain("One adapter = hypothetical seam. Two adapters = real seam.");
    expect(architecture).toContain("Replace tests, don't layer them");
    expect(architecture).toContain("docs/adr/ → projects/<project>/adrs/ with projects/<project>/decisions.md as the index");
    expect(architecture).toContain("File the review in the wiki before (or instead of) creating an external issue");
  });

  test("Architecture skill makes zero-tech-debt prominent", () => {
    const architecture = skill("improve-codebase-architecture");
    expect(architecture).toContain("## Zero-tech-debt lens");
    expect(architecture).toContain("Optimize for the code that should exist");
    expect(architecture).toContain("Search for real callers before preserving compatibility");
    expect(architecture).toContain("Delete dead compatibility paths instead of making them better");
    expect(architecture).toContain("Verify the intended flow");
  });

  test("TDD skill preserves Matt Pocock upstream workflow and routes evidence through Forge", () => {
    const tdd = skill("tdd");
    expect(tdd).toContain("## Philosophy");
    expect(tdd).toContain("Tests should verify behavior through public interfaces, not implementation details");
    expect(tdd).toContain("**Good tests** are integration-style");
    expect(tdd).toContain("## Anti-Pattern: Horizontal Slices");
    expect(tdd).toContain("DO NOT write all tests first, then all implementation");
    expect(tdd).toContain("Vertical slices via tracer bullets");
    expect(tdd).toContain("Ask: \"What should the public interface look like? Which behaviors are most important to test?\"");
    expect(tdd).toContain("Never refactor while RED");
    expect(tdd).toContain("wiki forge evidence <project> <slice> verify");
    expect(tdd).toContain("wiki forge tdd cycle <project> <slice>");
    expect(tdd).toContain("Do not use removed legacy commands");
    expect(tdd).not.toContain("Run slice verification: `wiki forge evidence");
  });

  test("TDD companion docs preserve upstream testing guidance", () => {
    expect(readFileSync("skills/tdd/tests.md", "utf8")).toContain("Integration-style");
    expect(readFileSync("skills/tdd/mocking.md", "utf8")).toContain("Mock at **system boundaries** only");
    expect(readFileSync("skills/tdd/interface-design.md", "utf8")).toContain("Accept dependencies, don't create them");
    expect(readFileSync("skills/tdd/deep-modules.md", "utf8")).toContain("Deep module");
    expect(readFileSync("skills/tdd/refactoring.md", "utf8")).toContain("Refactor Candidates");
  });

  test("workflow skills obey deterministic phase packets", () => {
    const forge = skill("forge");
    const wiki = skill("wiki");
    const tdd = skill("tdd");
    const grill = skill("grill-with-docs");
    const architecture = skill("improve-codebase-architecture");

    expect(forge).toContain("## Phase packet contract");
    expect(forge).toContain("Treat `phasePacket` from `wiki forge plan`, `wiki forge next`, and `wiki forge status` as workflow truth");
    expect(wiki).toContain("If a Forge `phasePacket` is present, do not override it with wiki-layer guesses");
    expect(tdd).toContain("Load this skill when the phase packet lists `tdd`");
    expect(grill).toContain("Load this skill when the phase packet lists `grill-with-docs`");
    expect(architecture).toContain("Load this skill when the phase packet lists `improve-codebase-architecture`");
    expect(architecture).toContain("accepted findings become Forge-tracked follow-up work");
  });
});
