export const FORGE_PHASES = [
  "research",
  "grill-with-docs",
  "spec",
  "slices",
  "ownership",
  "implementation",
  "tdd",
  "verification",
  "review",
  "close",
  "amend",
] as const;

export type ForgePhase = (typeof FORGE_PHASES)[number];

export const Forge_SKIPPABLE_PHASES = ["research", "grill-with-docs", "spec", "slices"] as const satisfies readonly ForgePhase[];
export type ForgeSkippablePhase = (typeof Forge_SKIPPABLE_PHASES)[number];

export const FORGE_WORKFLOW_LEDGER_PHASES = [
  "research",
  "grill-with-docs",
  "prd",
  "slices",
  "tdd",
  "verify",
] as const;
export type ForgeWorkflowLedgerPhase = (typeof FORGE_WORKFLOW_LEDGER_PHASES)[number];

export const SKIPPABLE_FORGE_WORKFLOW_LEDGER_PHASES = [
  "research",
  "grill-with-docs",
  "prd",
  "slices",
] as const satisfies readonly ForgeWorkflowLedgerPhase[];
export type SkippableForgeWorkflowLedgerPhase = (typeof SKIPPABLE_FORGE_WORKFLOW_LEDGER_PHASES)[number];

export type ForgePhaseDefinition = {
  readonly phase: ForgePhase;
  readonly required: boolean;
  readonly skippable: boolean;
};

export const Forge_PHASE_DEFINITIONS: readonly ForgePhaseDefinition[] = FORGE_PHASES.map((phase) => ({
  phase,
  required: phase !== "amend",
  skippable: isPhaseSkippable(phase),
}));

export function isForgePhase(value: string): value is ForgePhase {
  return (FORGE_PHASES as readonly string[]).includes(value);
}

export function isPhaseSkippable(phase: ForgePhase): phase is ForgeSkippablePhase {
  return (Forge_SKIPPABLE_PHASES as readonly string[]).includes(phase);
}

export function isForgeWorkflowLedgerPhase(value: unknown): value is ForgeWorkflowLedgerPhase {
  return (FORGE_WORKFLOW_LEDGER_PHASES as readonly unknown[]).includes(value);
}

export function isForgeWorkflowLedgerPhaseSkippable(phase: ForgeWorkflowLedgerPhase): phase is SkippableForgeWorkflowLedgerPhase {
  return (SKIPPABLE_FORGE_WORKFLOW_LEDGER_PHASES as readonly ForgeWorkflowLedgerPhase[]).includes(phase);
}

export function phasePrecedes(left: ForgePhase, right: ForgePhase): boolean {
  return FORGE_PHASES.indexOf(left) < FORGE_PHASES.indexOf(right);
}
