import { describe, expect, test } from "bun:test";
import { buildPhaseSkillPacket, renderPhaseSkillPacket } from "../../src/forge/workflow/phase-skill-packet";

describe("phase skill-chain packets", () => {
  test("plan packet makes grill-with-docs and Forge the deterministic planning chain", () => {
    const packet = buildPhaseSkillPacket("plan", { project: "wiki-forge", featureName: "Workflow packets" });

    expect(packet.kind).toBe("phase-skill-packet");
    expect(packet.phase).toBe("plan");
    expect(packet.workflowProfile).toBe("feature");
    expect(packet.requiredSkills).toEqual(["grill-with-docs", "forge"]);
    expect(packet.artifactOwner).toBe("forge");
    expect(packet.allowedWrites).toEqual(expect.arrayContaining(["agent-authored plan-answer input files"]));
    expect(packet.forbiddenWrites).toEqual(expect.arrayContaining(["direct PRD markdown writes", "direct slice markdown writes"]));
    expect(packet.subagentPolicy).toMatchObject({ allowed: true, mode: "read-only" });
    expect(packet.requiredOutputs).toEqual(expect.arrayContaining(["resolved context and decisions", "feature", "PRD", "slices"]));
    expect(packet.forbiddenFallbacks).toEqual(expect.arrayContaining(["do not create PRDs or slices without resolved planning context"]));
    const rendered = renderPhaseSkillPacket(packet);
    expect(rendered).toContain("Required skills: /grill-with-docs -> /forge");
    expect(rendered).toContain("Next commands:");
  });

  test("implementation packet requires Forge and TDD evidence gates", () => {
    const packet = buildPhaseSkillPacket("implementation", { project: "wiki-forge", sliceId: "WIKI-FORGE-273" });

    expect(packet.workflowProfile).toBe("feature");
    expect(packet.requiredSkills).toEqual(["forge", "tdd"]);
    expect(packet.artifactOwner).toBe("forge");
    expect(packet.allowedWrites).toEqual(expect.arrayContaining(["source and test files for the active slice"]));
    expect(packet.forbiddenWrites).toEqual(expect.arrayContaining(["direct Forge evidence frontmatter edits", "mutating inactive slices"]));
    expect(packet.subagentPolicy).toMatchObject({ allowed: true, mode: "review-evidence-only" });
    expect(packet.requiredOutputs).toEqual(expect.arrayContaining(["red TDD evidence", "green TDD evidence", "targeted verification", "review evidence"]));
    expect(packet.nextCommands).toContain("wiki forge tdd cycle wiki-forge WIKI-FORGE-273 --test <path> --red-command \"<failing test command>\" --green-command \"<passing test command>\"");
  });

  test("improvement-review packet routes architecture and desloppify findings back into Forge", () => {
    const packet = buildPhaseSkillPacket("improvement-review", { project: "wiki-forge" });

    expect(packet.workflowProfile).toBe("standalone-engineering");
    expect(packet.requiredSkills).toEqual(["improve-codebase-architecture", "desloppify", "forge"]);
    expect(packet.artifactOwner).toBe("wiki");
    expect(packet.allowedWrites).toEqual(expect.arrayContaining(["Wiki architecture review notes", "Forge plan-answer inputs for accepted follow-up work"]));
    expect(packet.forbiddenWrites).toEqual(expect.arrayContaining(["scanner-driven source edits without accepted Forge follow-up"]));
    expect(packet.subagentPolicy).toMatchObject({ allowed: true, mode: "read-only" });
    expect(packet.requiredOutputs).toEqual(expect.arrayContaining(["architecture findings", "desloppify findings", "accepted Forge-tracked follow-up work"]));
    expect(packet.forbiddenFallbacks).toContain("do not apply broad cleanup outside Forge-tracked slices");
    expect(renderPhaseSkillPacket(packet)).toContain("/improve-codebase-architecture -> /desloppify -> /forge");
  });
});
