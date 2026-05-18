import { describe, expect, test } from "bun:test";
import { DEFAULT_BENCH_COMMANDS } from "../../scripts/wiki-maintenance-bench";
import { WIKI_COMMANDS, resolveWikiCommand } from "../../src/wiki";
import { assertGeneratedProjectionReadAllowed, assertLifecycleMutationAllowed, getCommandSurfaceEntry, listCommandSurfaceEntries } from "../../src/wiki/runtime/command-surface";

const REMOVED_COMMANDS = [
  "status", "gate", "closeout", "backlog", "add-task", "move-task", "complete-task",
  "claim", "forge-start", "forge-verify", "forge-close", "pipeline", "pipeline-reset",
  "create-feature", "create-prd", "create-plan", "create-test-plan", "create-issue-slice",
  "start-feature", "close-feature", "start-prd", "close-prd", "migrate-verification",
];

describe("command surface registry", () => {
  test("classifies every top-level command registered in the CLI", () => {
    const classified = new Set(listCommandSurfaceEntries().flatMap((entry) => entry.publicCommands));
    const unclassified = Object.keys(WIKI_COMMANDS).filter((command) => !command.includes(":") && !classified.has(command));

    expect(unclassified).toEqual([]);
  });

  test("classifies Wiki memory commands separately from Forge workflow", () => {
    expect(getCommandSurfaceEntry("search")).toMatchObject({ domain: "wiki-memory", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("query")).toMatchObject({ domain: "wiki-memory", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("ask")).toMatchObject({ domain: "wiki-memory", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("handover")).toMatchObject({ domain: "wiki-memory", handler: "handover", mayMutateLifecycle: false });
    expect(getCommandSurfaceEntry("resume")).toMatchObject({ domain: "wiki-memory", handler: "resume", mayMutateLifecycle: false });
  });

  test("classifies Forge workflow commands as Forge-owned", () => {
    expect(getCommandSurfaceEntry("next")).toMatchObject({ domain: "forge-workflow", handler: "forge:next", mayMutateLifecycle: false, surface: "operator" });
    expect(getCommandSurfaceEntry("forge")).toMatchObject({ domain: "forge-workflow", handler: "forge:*", mayMutateLifecycle: false, surface: "namespace" });
    expect(getCommandSurfaceEntry("forge:next")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: false, surface: "operator" });
    expect(getCommandSurfaceEntry("forge:status")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: false, surface: "operator" });
    expect(getCommandSurfaceEntry("forge:improve")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: false, surface: "operator" });
    expect(getCommandSurfaceEntry("forge:run")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: true, surface: "operator" });
    expect(getCommandSurfaceEntry("forge:plan")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: true, surface: "operator" });
    expect(getCommandSurfaceEntry("forge:grill")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: true, surface: "operator" });
    expect(getCommandSurfaceEntry("forge:start")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: true, surface: "internal" });
    expect(getCommandSurfaceEntry("forge:evidence")).toMatchObject({ domain: "forge-workflow", mayMutateLifecycle: true, surface: "internal" });
  });

  test("keeps the recommended Forge operator surface small", () => {
    const operatorForgeCommands = listCommandSurfaceEntries()
      .filter((entry) => entry.domain === "forge-workflow" && entry.surface === "operator")
      .flatMap((entry) => entry.publicCommands)
      .sort();

    expect(operatorForgeCommands).toEqual([
      "forge:grill",
      "forge:improve",
      "forge:next",
      "forge:plan",
      "forge:run",
      "forge:status",
      "next",
    ]);
  });

  test("enforces lifecycle mutation and generated projection boundaries", () => {
    expect(() => assertLifecycleMutationAllowed("handover")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("search")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("status")).toThrow("unclassified command");
    expect(() => assertLifecycleMutationAllowed("forge")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("forge:next")).toThrow("cannot mutate Forge lifecycle");
    expect(() => assertLifecycleMutationAllowed("forge:start")).not.toThrow();

    expect(() => assertGeneratedProjectionReadAllowed("search")).toThrow("cannot read generated projections as authority");
    expect(() => assertGeneratedProjectionReadAllowed("dashboard")).not.toThrow();
  });

  test("removed workflow commands are absent, not quarantined", () => {
    for (const command of REMOVED_COMMANDS) {
      expect(getCommandSurfaceEntry(command)).toBeUndefined();
      expect(WIKI_COMMANDS[command]).toBeUndefined();
      expect(resolveWikiCommand([command, "demo"])).toEqual({ command, args: ["demo"] });
    }
  });

  test("maintenance benchmark does not invoke removed workflow commands", () => {
    for (const command of DEFAULT_BENCH_COMMANDS) {
      expect(REMOVED_COMMANDS).not.toContain(command);
    }
  });
});
