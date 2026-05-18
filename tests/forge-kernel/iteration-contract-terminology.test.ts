import { describe, expect, test } from "bun:test";
import { buildForgeIterationContract } from "../../src/forge/steering/iteration-contract";

describe("Forge iteration contract terminology", () => {
  test("verify phase starts at targeted verification in the remaining chain", () => {
    const contract = buildForgeIterationContract({
      phase: "verify",
      triage: {
        kind: "needs-verify",
        command: "wiki forge evidence wiki-forge WIKI-FORGE-001 verify --command \"bun test\"",
        reason: "targeted verification missing",
      },
    });

    expect(contract.remainingChain).toEqual(["targeted-verification", "desloppify", "review", "close"]);
  });

  test("uses current Forge concepts instead of legacy closeout/gate wording", () => {
    const contract = buildForgeIterationContract({
      phase: "complete",
      triage: {
        kind: "completed",
        command: "wiki forge next wiki-forge --repo . --json",
        reason: "slice is complete",
      },
    });

    expect(contract.remainingChain).toEqual(["close"]);
    expect(contract.reviewGates).toEqual(["review", "close"]);
    expect(contract.qualityGates).toEqual(["targeted-verification", "desloppify"]);
    expect(contract.subagentPolicy.reviewPasses.requiredWhen).toBe("after implementation changes before close");
    expect(contract.subagentPolicy.requiredSubagents[0]?.requiredWhen).toBe("after implementation changes before close");
  });
});
