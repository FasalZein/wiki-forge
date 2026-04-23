import type { ForgePhase } from "../status/workflow-ledger";
import type { ForgeTriage } from "./triage-types";

export type ForgeIterationContract = {
  currentAction: string;
  requiredSkill?: string;
  remainingChain: string[];
  qualityGates: string[];
  reviewGates: string[];
  designPressure: "none" | "flagged";
};

type BuildIterationContractInput = {
  phase: ForgePhase | "complete";
  triage: ForgeTriage;
  loadSkill?: string;
  designPressure?: boolean;
};

const PHASE_TO_CONCEPT: Record<ForgePhase, string> = {
  research: "research",
  "domain-model": "domain-model",
  prd: "write-a-prd",
  slices: "prd-to-slices",
  tdd: "tdd",
  verify: "verify",
};

const CONCEPTUAL_CHAIN = [
  "research",
  "domain-model",
  "write-a-prd",
  "prd-to-slices",
  "tdd",
  "verify",
  "desloppify",
  "review",
  "closeout",
  "gate",
] as const;

const QUALITY_GATES = ["verify", "desloppify"] as const;
const REVIEW_GATES = ["review", "closeout", "gate"] as const;

export function buildForgeIterationContract(input: BuildIterationContractInput): ForgeIterationContract {
  const chain = chainWithDesignPressure(Boolean(input.designPressure));
  const currentConcept = input.phase === "complete" ? "gate" : PHASE_TO_CONCEPT[input.phase];
  const currentIndex = chain.indexOf(currentConcept);
  const remainingChain = currentIndex >= 0 ? chain.slice(currentIndex) : chain;

  return {
    currentAction: input.triage.command,
    ...(input.loadSkill ? { requiredSkill: input.loadSkill } : {}),
    remainingChain,
    qualityGates: [...QUALITY_GATES],
    reviewGates: [...REVIEW_GATES],
    designPressure: input.designPressure ? "flagged" : "none",
  };
}

function chainWithDesignPressure(designPressure: boolean): string[] {
  if (!designPressure) return [...CONCEPTUAL_CHAIN];
  const chain: string[] = [...CONCEPTUAL_CHAIN];
  const domainModelIndex = chain.indexOf("domain-model");
  if (domainModelIndex === -1) return chain;
  chain.splice(domainModelIndex + 1, 0, "torpathy");
  return chain;
}
