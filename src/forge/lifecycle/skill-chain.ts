import { resolveNextRequiredPhase, type ReviewPolicy } from "./phase-gates";
import type { ForgePhase } from "./phase";

export type SkillChainEntry = {
  readonly phase: ForgePhase;
  readonly skill: string;
  readonly required: boolean;
};

export type SkillChainPacket = {
  readonly nextPhase: ForgePhase | null;
  readonly requiredSkill: string | null;
  readonly chain: readonly SkillChainEntry[];
};

const DEFAULT_SKILL_CHAIN: readonly SkillChainEntry[] = [
  { phase: "research", skill: "/research", required: true },
  { phase: "domain-model", skill: "/domain-model", required: true },
  { phase: "spec", skill: "/write-a-prd", required: true },
  { phase: "slices", skill: "/prd-to-slices", required: true },
  { phase: "ownership", skill: "wiki forge start", required: true },
  { phase: "implementation", skill: "/forge", required: true },
  { phase: "tdd", skill: "/tdd", required: true },
  { phase: "verification", skill: "wiki verify-slice", required: true },
  { phase: "review", skill: "reviewer subagents", required: true },
  { phase: "close", skill: "wiki forge run", required: true },
  { phase: "amend", skill: "wiki forge amend", required: false },
];

export type BuildSkillChainPacketInput = {
  readonly completedPhases: readonly ForgePhase[];
  readonly reviewPolicy?: ReviewPolicy;
};

export function getDefaultSkillChain(): readonly SkillChainEntry[] {
  return DEFAULT_SKILL_CHAIN;
}

export function buildSkillChainPacket(input: BuildSkillChainPacketInput): SkillChainPacket {
  const nextPhase = resolveNextRequiredPhase(input.completedPhases, input.reviewPolicy ?? { required: true });
  return {
    nextPhase,
    requiredSkill: nextPhase ? DEFAULT_SKILL_CHAIN.find((entry) => entry.phase === nextPhase)?.skill ?? null : null,
    chain: DEFAULT_SKILL_CHAIN,
  };
}
