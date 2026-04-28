export type CommandSurfaceDomain = "wiki-memory" | "forge-workflow" | "admin-view" | "migration" | "legacy-quarantined";

export type CommandSurfaceEntry = {
  readonly publicCommands: readonly string[];
  readonly domain: CommandSurfaceDomain;
  readonly mayMutateLifecycle: boolean;
  readonly mayReadGeneratedProjections: boolean;
  readonly v1Handler?: string;
  readonly replacement?: string;
  readonly reason: string;
};

const COMMAND_SURFACE = [
  entry(["help"], "admin-view", "Help renders command documentation."),
  entry(["scaffold-project", "onboard", "onboard-plan", "create-module", "normalize-module", "protocol", "protocol:sync", "protocol:audit", "obsidian", "setup-shell", "config", "schema"], "admin-view", "Setup/configuration commands; not workflow authority."),
  entry(["search", "query", "ask", "file-answer", "research", "research:scaffold", "research:status", "research:ingest", "research:file", "research:lint", "research:audit", "research:handoff", "research:bridge", "research:distill", "research:adopt", "source", "source:ingest", "qmd-status", "qmd-update", "qmd-embed", "qmd-setup"], "wiki-memory", "Wiki memory and retrieval commands."),
  entry(["handover"], "wiki-memory", "Typed V1 handover memory object.", { v1Handler: "v1:handover" }),
  entry(["resume"], "wiki-memory", "Typed V1 resume packet from handover memory and Forge status truth.", { v1Handler: "v1:resume" }),
  entry(["note", "log", "export-prompt"], "wiki-memory", "Session memory/prompt commands that require V1 redesign before more routing."),
  entry(["forge"], "forge-workflow", "Forge workflow namespace mounted under Wiki.", { v1Handler: "forge:*", mayMutateLifecycle: true }),
  entry(["next"], "forge-workflow", "Top-level alias for V1 Forge next action.", { v1Handler: "v1:forge:next", mayMutateLifecycle: false }),
  entry(["v1", "v1:forge:next", "v1:forge:status", "v1:forge:plan", "v1:forge:start", "v1:forge:release", "v1:forge:amend", "v1:forge:check", "v1:forge:close", "v1:forge:run", "v1:forge:evidence", "v1:forge:review", "v1:handover", "v1:resume", "v1:compat"], "admin-view", "Explicit V1/internal command namespace."),
  entry(["dashboard", "dependency-graph", "summary", "update-index", "feature-status", "scaffold-layer", "create-layer-page", "lint-vault"], "admin-view", "Generated views or hierarchy admin; never lifecycle authority.", { mayReadGeneratedProjections: true }),
  entry(["checkpoint", "maintain", "refresh", "refresh-from-git", "sync", "discover", "ingest-diff", "commit-check", "install-git-hook", "refresh-on-merge", "lint-repo", "doctor", "gate", "closeout", "status", "lint", "lint-semantic", "verify", "bind", "drift-check", "verify-page", "migrate-verification", "cache-clear", "acknowledge-impact"], "admin-view", "Wiki maintenance/freshness/verification admin; must not be treated as Forge lifecycle authority."),
  entry(["create-feature", "create-prd", "create-plan", "create-test-plan", "create-issue-slice", "start-feature", "close-feature", "start-prd", "close-prd"], "legacy-quarantined", "Legacy planning/lifecycle command; V1 planning owns artifact creation.", { replacement: "wiki forge plan" }),
  entry(["backlog", "add-task", "move-task", "complete-task"], "legacy-quarantined", "Legacy backlog command; V1 Forge status/next/close own lifecycle.", { replacement: "wiki forge status" }),
  entry(["claim", "start-slice"], "legacy-quarantined", "Legacy slice claim command; V1 start owns the invariant.", { replacement: "wiki forge start" }),
  entry(["verify-slice"], "legacy-quarantined", "Legacy slice verification command; V1 evidence/check own verification.", { replacement: "wiki forge evidence" }),
  entry(["close-slice"], "legacy-quarantined", "Legacy slice close command; V1 close owns closure.", { replacement: "wiki forge close" }),
  entry(["pipeline", "pipeline-reset"], "legacy-quarantined", "Legacy pipeline command; V1 run/status/evidence own orchestration.", { replacement: "wiki forge run" }),
] as const satisfies readonly CommandSurfaceEntry[];

export function listCommandSurfaceEntries(): readonly CommandSurfaceEntry[] {
  return COMMAND_SURFACE;
}

export function getCommandSurfaceEntry(command: string): CommandSurfaceEntry | undefined {
  return COMMAND_SURFACE.find((entry) => entry.publicCommands.includes(command));
}

export function assertCommandNotQuarantined(command: string): void {
  const entry = getCommandSurfaceEntry(command);
  if (entry?.domain !== "legacy-quarantined") return;
  throw new Error(`legacy workflow command is quarantined: ${command}. Use ${entry.replacement ?? "a V1 command"}.`);
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
    ...(options.v1Handler ? { v1Handler: options.v1Handler } : {}),
    ...(options.replacement ? { replacement: options.replacement } : {}),
  };
}
