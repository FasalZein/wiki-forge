import { afterEach, describe, expect, test } from "bun:test";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveForgeCommand } from "../../src/forge";

afterEach(() => cleanupTempPaths());

describe("Forge improvement-review packet command", () => {
  test("resolver maps forge improve to the improvement packet command", () => {
    expect(resolveForgeCommand(["improve", "demo"])).toEqual({
      command: "forge:improve",
      args: ["demo"],
    });
  });

  test("emits improvement-review phase packet without mutating lifecycle", () => {
    const vault = tempDir("wiki-forge-improve-vault");
    initVault(vault);

    const result = runWiki(["forge", "improve", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "ok",
      project: "demo",
      phasePacket: {
        kind: "phase-skill-packet",
        phase: "improvement-review",
        requiredSkills: ["improve-codebase-architecture", "desloppify", "forge"],
        requiredOutputs: expect.arrayContaining(["architecture findings", "desloppify findings", "accepted Forge-tracked follow-up work"]),
        forbiddenFallbacks: expect.arrayContaining(["do not apply broad cleanup outside Forge-tracked slices"]),
      },
    });
  });

  test("text output is compact and names the skill chain", () => {
    const vault = tempDir("wiki-forge-improve-text-vault");
    initVault(vault);

    const result = runWiki(["forge", "improve", "demo"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Required skills: /improve-codebase-architecture -> /desloppify -> /forge");
    expect(result.stdout.toString()).toContain("accepted Forge-tracked follow-up work");
  });
});
