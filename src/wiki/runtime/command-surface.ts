export type CommandSurfaceDomain = "wiki-memory" | "forge-workflow" | "admin-view" | "migration";

export type CommandSurfaceEntry = {
  readonly publicCommands: readonly string[];
  readonly domain: CommandSurfaceDomain;
  readonly mayMutateLifecycle: boolean;
  readonly mayReadGeneratedProjections: boolean;
  readonly handler?: string;
  readonly reason: string;
};

const COMMAND_SURFACE = [
  entry(["help"], "admin-view", "Help renders command documentation."),
  entry(["scaffold-project", "onboard", "onboard-plan", "create-module", "normalize-module", "protocol", "protocol:sync", "protocol:audit", "obsidian", "setup-shell", "config", "schema"], "admin-view", "Setup/configuration commands; not workflow authority."),
  entry(["search", "query", "ask", "file-answer", "research", "research:scaffold", "research:status", "research:ingest", "research:file", "research:lint", "research:audit", "research:handoff", "research:bridge", "source", "source:ingest", "qmd-status", "qmd-update", "qmd-embed", "qmd-setup"], "wiki-memory", "Wiki memory and retrieval commands."),
  entry(["handover"], "wiki-memory", "Typed handover memory object.", { handler: "handover" }),
  entry(["resume"], "wiki-memory", "Typed resume packet from handover memory and Forge status truth.", { handler: "resume" }),
  entry(["note", "log"], "wiki-memory", "Typed project memory entries that do not mutate Forge lifecycle.", { handler: "memory" }),
  entry(["export-prompt"], "wiki-memory", "Prompt packet rendered from handover memory and Forge status truth.", { handler: "export-prompt" }),
  entry(["forge"], "forge-workflow", "Forge workflow namespace mounted under Wiki.", { handler: "forge:*", mayMutateLifecycle: true }),
  entry(["next"], "forge-workflow", "Top-level alias for Forge next action.", { handler: "forge:next", mayMutateLifecycle: false }),
  entry(["dashboard", "dependency-graph", "summary", "update-index", "feature-status", "scaffold-layer", "create-layer-page", "lint-vault"], "admin-view", "Generated views or hierarchy admin; never lifecycle authority.", { mayReadGeneratedProjections: true }),
  entry(["checkpoint", "maintain", "refresh", "refresh-from-git", "sync", "discover", "ingest-diff", "commit-check", "install-git-hook", "refresh-on-merge", "lint-repo", "doctor", "lint", "lint-semantic", "verify", "bind", "drift-check", "verify-page", "migrate-verification", "cache-clear", "acknowledge-impact"], "admin-view", "Wiki maintenance/freshness/verification admin; must not be treated as Forge lifecycle authority."),
] as const satisfies readonly CommandSurfaceEntry[];

export function listCommandSurfaceEntries(): readonly CommandSurfaceEntry[] {
  return COMMAND_SURFACE;
}

export function getCommandSurfaceEntry(command: string): CommandSurfaceEntry | undefined {
  return COMMAND_SURFACE.find((entry) => entry.publicCommands.includes(command));
}

export function assertLifecycleMutationAllowed(command: string): void {
  const entry = requireCommandSurfaceEntry(command);
  if (entry.mayMutateLifecycle) return;
  throw new Error(`command cannot mutate Forge lifecycle: ${command}`);
}

export function assertGeneratedProjectionReadAllowed(command: string): void {
  const entry = requireCommandSurfaceEntry(command);
  if (entry.mayReadGeneratedProjections) return;
  throw new Error(`command cannot read generated projections as authority: ${command}`);
}

function requireCommandSurfaceEntry(command: string): CommandSurfaceEntry {
  const entry = getCommandSurfaceEntry(command);
  if (!entry) throw new Error(`unclassified command: ${command}`);
  return entry;
}

function entry(
  publicCommands: readonly string[],
  domain: CommandSurfaceDomain,
  reason: string,
  options: Partial<Omit<CommandSurfaceEntry, "publicCommands" | "domain" | "reason">> = {},
): CommandSurfaceEntry {
  return {
    publicCommands,
    domain,
    reason,
    mayMutateLifecycle: options.mayMutateLifecycle ?? domain === "forge-workflow",
    mayReadGeneratedProjections: options.mayReadGeneratedProjections ?? false,
    ...(options.handler ? { handler: options.handler } : {}),
  };
}
