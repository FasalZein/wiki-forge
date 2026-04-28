import { detectOwnershipOverlap, type OwnershipGrant, type OwnershipOverlap } from "../kernel/ownership";
import type { V1ForgePhase } from "./phase";

export type SubagentMode = "scout" | "planning" | "spec" | "implementation" | "review";

export type SubagentGrant = OwnershipGrant & {
  readonly mode: SubagentMode;
  readonly phase?: V1ForgePhase;
  readonly canMutateLifecycle: boolean;
  readonly delegatedCanonicalArtifacts?: boolean;
};

export type SubagentPolicyInput = {
  readonly phase: V1ForgePhase;
  readonly grants: readonly SubagentGrant[];
};

export type SubagentPolicyResult =
  | { readonly status: "accepted"; readonly defaultAccess: "read-only" | "implementation-grants-only" | "review-evidence-only" | "delegated-canonical-artifacts" }
  | { readonly status: "rejected"; readonly reason: string; readonly overlaps?: readonly OwnershipOverlap[]; readonly phases?: readonly V1ForgePhase[] };

export function evaluateSubagentPolicy(input: SubagentPolicyInput): SubagentPolicyResult {
  const grantPhases = unique(input.grants.flatMap((grant) => grant.phase ? [grant.phase] : []));
  if (grantPhases.length > 1 || (grantPhases.length === 1 && grantPhases[0] !== input.phase)) {
    return {
      status: "rejected",
      reason: "parallel subagents must operate inside one lifecycle phase",
      phases: grantPhases,
    };
  }

  if (input.grants.every((grant) => grant.mode === "scout" || grant.mode === "planning")) {
    if (input.grants.some((grant) => grant.canMutateLifecycle)) {
      return { status: "rejected", reason: "planning and scouting subagents are read-only by default" };
    }
    return { status: "accepted", defaultAccess: "read-only" };
  }

  if (input.grants.every((grant) => grant.mode === "review")) {
    if (input.grants.some((grant) => grant.canMutateLifecycle)) {
      return { status: "rejected", reason: "review subagents may only produce review evidence" };
    }
    return { status: "accepted", defaultAccess: "review-evidence-only" };
  }

  if (input.grants.every((grant) => grant.mode === "spec")) {
    if (input.grants.every((grant) => grant.delegatedCanonicalArtifacts)) {
      return { status: "accepted", defaultAccess: "delegated-canonical-artifacts" };
    }
    return { status: "rejected", reason: "canonical workflow pages and lifecycle state are parent-owned unless explicitly delegated" };
  }

  if (input.grants.every((grant) => grant.mode === "implementation")) {
    const overlaps = detectOwnershipOverlap(input.grants);
    if (overlaps.length > 0) {
      return {
        status: "rejected",
        reason: "parallel implementation requires non-overlapping file and slice grants",
        overlaps,
      };
    }
    if (input.grants.some((grant) => grant.canMutateLifecycle && !grant.delegatedCanonicalArtifacts)) {
      return { status: "rejected", reason: "canonical lifecycle mutation requires explicit parent/kernel delegation" };
    }
    return { status: "accepted", defaultAccess: "implementation-grants-only" };
  }

  return { status: "rejected", reason: "mixed subagent modes require a parent-authored execution plan" };
}

function unique<TValue>(values: readonly TValue[]): readonly TValue[] {
  return [...new Set(values)];
}
