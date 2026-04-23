import { TEST_VERIFIED_LEVEL } from "../../constants";
import { buildForgeIterationContract, type ForgeIterationContract } from "./iteration-contract";
import { isForgeRunTriage, isPrePhaseTriage, type ForgeTriage } from "./triage-types";
import type { ForgePhase } from "../status/workflow-ledger";

export type ForgeLane =
  | "domain-work"
  | "implementation-work"
  | "maintenance-refresh"
  | "verify-close"
  | "audited-exception";

export type ForgeSteeringPacket = {
  lane: ForgeLane;
  phase: ForgePhase | "complete";
  nextCommand: string;
  why: string;
  loadSkill?: string;
  iterationContract: ForgeIterationContract;
};

const MAINTENANCE_REPAIR_SUBCOMMANDS = new Set([
  "checkpoint",
  "lint-repo",
  "maintain",
  "update-index",
  "closeout",
  "sync",
  "refresh-from-git",
  "acknowledge-impact",
  "bind",
  "verify-page",
]);

type BuildForgeSteeringInput = {
  project: string;
  sliceId: string | null;
  triage: ForgeTriage;
  nextPhase: ForgePhase | null;
  planStatus?: TaskDocState | null;
  testPlanStatus?: TaskDocState | null;
  verificationLevel?: string | null;
  sliceStatus?: string | null;
  section?: string | null;
  canonicalCompletion?: boolean;
  designPressure?: boolean;
};

type TaskDocState = "missing" | "incomplete" | "ready";

export function buildForgeSteering(input: BuildForgeSteeringInput): ForgeSteeringPacket {
  const phase = input.nextPhase ?? "complete";
  const withContract = (packet: Omit<ForgeSteeringPacket, "iterationContract">): ForgeSteeringPacket => ({
    ...packet,
    iterationContract: buildForgeIterationContract({
      phase: packet.phase,
      triage: input.triage,
      loadSkill: packet.loadSkill,
      designPressure: input.designPressure,
    }),
  });

  if (!input.sliceId) {
    return withContract({
      lane: "maintenance-refresh",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      ...(input.triage.loadSkill ? { loadSkill: input.triage.loadSkill } : {}),
    });
  }

  if (input.triage.kind === "resume-failed-forge") {
    return withContract({
      lane: isMaintenanceRepairCommand(input.triage.command) ? "maintenance-refresh" : "verify-close",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    });
  }

  if (input.triage.kind === "completed") {
    return withContract({
      lane: "maintenance-refresh",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    });
  }

  if (isPrePhaseTriage(input.triage)) {
    const lane = input.nextPhase === "tdd" ? "implementation-work" : "domain-work";
    const loadSkill = input.nextPhase === "tdd" ? "/tdd" : input.triage.loadSkill;
    return withContract({
      lane,
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      ...(loadSkill ? { loadSkill } : {}),
    });
  }

  if (isForgeRunTriage(input.triage)) {
    const loadSkill = input.verificationLevel === TEST_VERIFIED_LEVEL
      ? undefined
      : input.nextPhase === "verify"
        ? "/desloppify"
        : "/tdd";
    return withContract({
      lane: input.verificationLevel === TEST_VERIFIED_LEVEL ? "verify-close" : "implementation-work",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      ...(loadSkill ? { loadSkill } : {}),
    });
  }

  if (input.planStatus !== "ready" || input.testPlanStatus !== "ready" || input.triage.kind === "fill-docs") {
    return withContract({
      lane: "implementation-work",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      loadSkill: "/tdd",
    });
  }

  if (input.canonicalCompletion) {
    return withContract({
      lane: "maintenance-refresh",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    });
  }

  if (input.verificationLevel === TEST_VERIFIED_LEVEL) {
    return withContract({
      lane: "verify-close",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    });
  }

  return withContract({
    lane: "implementation-work",
    phase,
    nextCommand: input.triage.command,
    why: input.triage.reason,
    ...(input.triage.loadSkill ? { loadSkill: input.triage.loadSkill } : {}),
  });
}

export function isMaintenanceRepairCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  const match = command.trim().match(/^wiki\s+(\S+)/u);
  return match ? MAINTENANCE_REPAIR_SUBCOMMANDS.has(match[1]) : false;
}

export function renderSteeringPacket(steering: ForgeSteeringPacket): string[] {
  const lines = [
    `lane: ${steering.lane}`,
    `phase: ${steering.phase}`,
    `next: ${steering.nextCommand}`,
    `why: ${steering.why}`,
    `iteration-contract: ${steering.iterationContract.remainingChain.join(" -> ")}`,
    `quality-gates: ${steering.iterationContract.qualityGates.join(" -> ")}`,
    `review-gates: ${steering.iterationContract.reviewGates.join(" -> ")}`,
  ];
  if (steering.loadSkill) {
    lines.splice(2, 0, `load-skill: ${steering.loadSkill}`);
  }
  if (steering.iterationContract.designPressure === "flagged") {
    lines.push("design-pressure: torpathy required");
  }
  return lines;
}
