import { describe, expect, test } from "bun:test";
import { detectOwnershipOverlap } from "../../src/v1/kernel/ownership";
import { evaluateSubagentPolicy } from "../../src/v1/forge/subagent-policy";

describe("v1 subagent execution policy", () => {
  test("parallel implementation grants with overlapping files are rejected", () => {
    expect(detectOwnershipOverlap([
      { agentId: "worker-a", files: ["src/v1/forge/next-intent.ts"], slices: ["WIKI-FORGE-217"] },
      { agentId: "worker-b", files: ["src/v1/forge/next-intent.ts"], slices: ["WIKI-FORGE-218"] },
    ])).toEqual([
      {
        kind: "file-overlap",
        resource: "src/v1/forge/next-intent.ts",
        agentIds: ["worker-a", "worker-b"],
      },
    ]);

    expect(evaluateSubagentPolicy({
      phase: "implementation",
      grants: [
        { agentId: "worker-a", mode: "implementation", files: ["src/v1/a.ts"], slices: ["WIKI-FORGE-216"], canMutateLifecycle: false },
        { agentId: "worker-b", mode: "implementation", files: ["src/v1/a.ts"], slices: ["WIKI-FORGE-216"], canMutateLifecycle: false },
      ],
    })).toEqual({
      status: "rejected",
      reason: "parallel implementation requires non-overlapping file and slice grants",
      overlaps: [
        { kind: "file-overlap", resource: "src/v1/a.ts", agentIds: ["worker-a", "worker-b"] },
        { kind: "slice-overlap", resource: "WIKI-FORGE-216", agentIds: ["worker-a", "worker-b"] },
      ],
    });
  });

  test("cross-phase parallelism is rejected", () => {
    expect(evaluateSubagentPolicy({
      phase: "tdd",
      grants: [
        { agentId: "scout", mode: "scout", phase: "research", files: [], slices: [], canMutateLifecycle: false },
        { agentId: "worker", mode: "implementation", phase: "implementation", files: ["src/v1/x.ts"], slices: ["WIKI-FORGE-216"], canMutateLifecycle: false },
      ],
    })).toEqual({
      status: "rejected",
      reason: "parallel subagents must operate inside one lifecycle phase",
      phases: ["research", "implementation"],
    });
  });

  test("review agents can run in parallel but cannot mutate lifecycle state", () => {
    expect(evaluateSubagentPolicy({
      phase: "review",
      grants: [
        { agentId: "reviewer-a", mode: "review", files: [], slices: ["WIKI-FORGE-216"], canMutateLifecycle: false },
        { agentId: "reviewer-b", mode: "review", files: [], slices: ["WIKI-FORGE-216"], canMutateLifecycle: false },
      ],
    })).toEqual({ status: "accepted", defaultAccess: "review-evidence-only" });

    expect(evaluateSubagentPolicy({
      phase: "review",
      grants: [
        { agentId: "reviewer-a", mode: "review", files: [], slices: ["WIKI-FORGE-216"], canMutateLifecycle: true },
      ],
    })).toEqual({
      status: "rejected",
      reason: "review subagents may only produce review evidence",
    });
  });

  test("spec writing remains parent-owned unless explicitly delegated", () => {
    expect(evaluateSubagentPolicy({
      phase: "spec",
      grants: [
        { agentId: "planner", mode: "spec", files: ["projects/wiki-forge/specs/prds/PRD-090.md"], slices: [], canMutateLifecycle: false },
      ],
    })).toEqual({
      status: "rejected",
      reason: "canonical workflow pages and lifecycle state are parent-owned unless explicitly delegated",
    });

    expect(evaluateSubagentPolicy({
      phase: "spec",
      grants: [
        { agentId: "planner", mode: "spec", files: ["projects/wiki-forge/specs/prds/PRD-090.md"], slices: [], canMutateLifecycle: false, delegatedCanonicalArtifacts: true },
      ],
    })).toEqual({ status: "accepted", defaultAccess: "delegated-canonical-artifacts" });
  });

  test("planning and scouting subagents are read-only by default", () => {
    expect(evaluateSubagentPolicy({
      phase: "research",
      grants: [
        { agentId: "scout", mode: "scout", files: [], slices: [], canMutateLifecycle: false },
        { agentId: "planner", mode: "planning", files: [], slices: [], canMutateLifecycle: false },
      ],
    })).toEqual({ status: "accepted", defaultAccess: "read-only" });
  });
});
