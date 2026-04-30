import type { ForgePhase } from "../status/workflow-ledger";
import type { ForgeTriage } from "./triage-types";

export type ForgeSubagentPolicy = {
  stage: "planning-linear" | "implementation-evaluate" | "review-multi-pass";
  strategyEvaluationRequired: boolean;
  implementationStrategies: Array<"subagent-driven" | "linear">;
  conflictChecks: string[];
  requiredSubagents: Array<{
    role: string;
    count: number;
    requiredWhen: string;
    artifact: string;
    model?: string;
  }>;
  reviewPasses: {
    minimum: number;
    model: "gpt-5.5";
    requiredWhen: string;
    gapHandling: "fix-now-or-record-follow-up-refactor";
  };
  iterationMode: "slice-phase-contract";
};

export type ForgeIterationContract = {
  currentAction: string;
  requiredSkill?: string;
  remainingChain: string[];
  qualityGates: string[];
  reviewGates: string[];
  designPressure: "none" | "flagged";
  subagentPolicy: ForgeSubagentPolicy;
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
    subagentPolicy: buildSubagentPolicy(input.phase),
  };
}

function buildSubagentPolicy(phase: ForgePhase | "complete"): ForgeSubagentPolicy {
  if (phase === "tdd") {
    return {
      stage: "implementation-evaluate",
      strategyEvaluationRequired: true,
      implementationStrategies: ["subagent-driven", "linear"],
      conflictChecks: [
        "overlapping-file-ownership",
        "shared-state-or-migration-risk",
        "coordination-cost-exceeds-slice-size",
        "hidden-context-or-artifact-handoff-risk",
      ],
      requiredSubagents: [
        {
          role: "strategy-evaluator",
          count: 1,
          requiredWhen: "before implementation edits",
          artifact: "subagent-vs-linear decision with conflict rationale",
        },
      ],
      reviewPasses: noReviewPasses(),
      iterationMode: "slice-phase-contract",
    };
  }

  if (phase === "verify" || phase === "complete") {
    return {
      stage: "review-multi-pass",
      strategyEvaluationRequired: true,
      implementationStrategies: ["subagent-driven", "linear"],
      conflictChecks: [
        "reviewers-touch-no-files",
        "independent-review-scopes-do-not-overlap-with-active-fixes",
        "residual-gaps-have-owner-and-follow-up-path",
      ],
      requiredSubagents: [
        {
          role: "reviewer",
          count: 2,
          model: "gpt-5.5",
          requiredWhen: "after implementation changes before closeout",
          artifact: "blockers, regression risks, and residual refactor gaps",
        },
      ],
      reviewPasses: {
        minimum: 2,
        model: "gpt-5.5",
        requiredWhen: "after implementation changes before closeout",
        gapHandling: "fix-now-or-record-follow-up-refactor",
      },
      iterationMode: "slice-phase-contract",
    };
  }

  return {
    stage: "planning-linear",
    strategyEvaluationRequired: false,
    implementationStrategies: ["linear"],
    conflictChecks: [],
    requiredSubagents: [],
    reviewPasses: noReviewPasses(),
    iterationMode: "slice-phase-contract",
  };
}

function noReviewPasses(): ForgeSubagentPolicy["reviewPasses"] {
  return {
    minimum: 0,
    model: "gpt-5.5",
    requiredWhen: "not required for this phase",
    gapHandling: "fix-now-or-record-follow-up-refactor",
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
