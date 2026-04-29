export const FORGE_PHASES = [
  "research",
  "domain-model",
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

export const Forge_SKIPPABLE_PHASES = ["research", "domain-model", "spec", "slices"] as const satisfies readonly ForgePhase[];
export type ForgeSkippablePhase = (typeof Forge_SKIPPABLE_PHASES)[number];

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

export function phasePrecedes(left: ForgePhase, right: ForgePhase): boolean {
  return FORGE_PHASES.indexOf(left) < FORGE_PHASES.indexOf(right);
}
