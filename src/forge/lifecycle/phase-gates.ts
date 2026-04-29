import { FORGE_PHASES, isPhaseSkippable, phasePrecedes, type ForgePhase } from "./phase";

export type ReviewPolicy = {
  readonly required: boolean;
};

export type PhaseCompletionInput = {
  readonly phase: ForgePhase;
  readonly skipped?: boolean;
  readonly auditReason?: string;
};

export type PhaseCompletionValidation =
  | { readonly status: "valid" }
  | { readonly status: "invalid"; readonly reason: string };

export type PhaseTransitionInput = {
  readonly completedPhases: readonly ForgePhase[];
  readonly requestedPhase: ForgePhase;
  readonly reviewPolicy?: ReviewPolicy;
};

export type PhaseTransitionGate =
  | { readonly status: "allowed" }
  | { readonly status: "blocked"; readonly nextRequiredPhase: ForgePhase; readonly reason: string };

export function validatePhaseCompletion(input: PhaseCompletionInput): PhaseCompletionValidation {
  if (!input.skipped) return { status: "valid" };
  if (!isPhaseSkippable(input.phase)) {
    return {
      status: "invalid",
      reason: `phase ${input.phase} is not skippable`,
    };
  }
  if (!input.auditReason?.trim()) {
    return {
      status: "invalid",
      reason: `skipped phase ${input.phase} requires an audit reason`,
    };
  }
  return { status: "valid" };
}

export function validatePhaseTransition(input: PhaseTransitionInput): PhaseTransitionGate {
  const nextRequiredPhase = resolveNextRequiredPhase(input.completedPhases, input.reviewPolicy ?? { required: true });
  if (!nextRequiredPhase) return { status: "allowed" };
  if (nextRequiredPhase === input.requestedPhase) return { status: "allowed" };
  if (phasePrecedes(input.requestedPhase, nextRequiredPhase)) return { status: "allowed" };
  return {
    status: "blocked",
    nextRequiredPhase,
    reason: `phase ${nextRequiredPhase} must complete before ${input.requestedPhase}`,
  };
}

export function resolveNextRequiredPhase(completedPhases: readonly ForgePhase[], reviewPolicy: ReviewPolicy = { required: true }): ForgePhase | null {
  const completed = new Set(completedPhases);
  for (const phase of FORGE_PHASES) {
    if (phase === "amend") continue;
    if (phase === "review" && !reviewPolicy.required) continue;
    if (!completed.has(phase)) return phase;
  }
  return null;
}
