import { describe, expect, test } from "bun:test";
import { WIKI_COMMANDS, resolveWikiCommand } from "../../src/wiki";
import { assertLifecycleMutationAllowed, assertGeneratedProjectionReadAllowed, getCommandSurfaceEntry, listCommandSurfaceEntries } from "../../src/v1/cli/command-surface";

describe("V1 command surface registry", () => {
  test("classifies every top-level command registered in the CLI", () => {
    const classified = new Set(listCommandSurfaceEntries().flatMap((entry) => entry.publicCommands));
    const unclassified = Object.keys(WIKI_COMMANDS).filter((command) => !command.includes(":") && !classified.has(command));

    expect(unclassified).toEqual([]);
  });

  test("classifies Wiki memory commands separately from Forge workflow", () => {
    expect(getCommandSurfaceEntry("search")).toMatchObject({ domain: "wiki-memory", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("query")).toMatchObject({ domain: "wiki-memory", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("ask")).toMatchObject({ domain: "wiki-memory", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("handover")).toMatchObject({ domain: "wiki-memory", v1Handler: "v1:handover", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("resume")).toMatchObject({ domain: "wiki-memory", v1Handler: "v1:resume", mayMutateLifecycle: false });
  });

  test("classifies Forge workflow commands as V1-owned", () => {
    expect(getCommandSurfaceEntry("next")).toMatchObject({ domain: "forge-workflow", v1Handler: "v1:forge:next", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("forge")).toMatchObject({ domain: "forge-workflow", v1Handler: "forge:*" });
  });

  test("enforces lifecycle mutation and generated projection boundaries", () => {
    expect(() => assertLifecycleMutationAllowed("handover")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("search")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("status")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("forge")).not.toThrow();

    expect(() => assertGeneratedProjectionReadAllowed("search")).toThrow("cannot read generated projections as authority");
    expect(() => assertGeneratedProjectionReadAllowed("dashboard")).not.toThrow();
  });

  test("quarantines legacy workflow commands instead of routing them to legacy", async () => {
    for (const command of ["backlog", "add-task", "move-task", "complete-task", "claim", "start-slice", "verify-slice", "close-slice", "pipeline", "pipeline-reset", "create-feature", "create-prd", "create-plan", "create-test-plan", "create-issue-slice", "start-feature", "close-feature", "start-prd", "close-prd"]) {
      expect(getCommandSurfaceEntry(command)).toMatchObject({ domain: "legacy-quarantined" });
      expect(() => resolveWikiCommand([command, "demo"])).toThrow("legacy workflow command is quarantined");
      await expect(WIKI_COMMANDS[command](["demo"])).rejects.toThrow("legacy workflow command is quarantined");
    }
  });
});
