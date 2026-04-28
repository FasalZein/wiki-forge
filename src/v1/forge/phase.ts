export const V1_FORGE_PHASES = [
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

export type V1ForgePhase = (typeof V1_FORGE_PHASES)[number];

export const V1_SKIPPABLE_PHASES = ["research", "domain-model", "spec", "slices"] as const satisfies readonly V1ForgePhase[];
export type V1SkippablePhase = (typeof V1_SKIPPABLE_PHASES)[number];

export type V1PhaseDefinition = {
  readonly phase: V1ForgePhase;
  readonly required: boolean;
  readonly skippable: boolean;
};

export const V1_PHASE_DEFINITIONS: readonly V1PhaseDefinition[] = V1_FORGE_PHASES.map((phase) => ({
  phase,
  required: phase !== "amend",
  skippable: isPhaseSkippable(phase),
}));

export function isV1ForgePhase(value: string): value is V1ForgePhase {
  return (V1_FORGE_PHASES as readonly string[]).includes(value);
}

export function isPhaseSkippable(phase: V1ForgePhase): phase is V1SkippablePhase {
  return (V1_SKIPPABLE_PHASES as readonly string[]).includes(phase);
}

export function phasePrecedes(left: V1ForgePhase, right: V1ForgePhase): boolean {
  return V1_FORGE_PHASES.indexOf(left) < V1_FORGE_PHASES.indexOf(right);
}
