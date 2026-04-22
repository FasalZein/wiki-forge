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
};

const MAINTENANCE_REPAIR_COMMAND_PREFIXES = [
  "wiki checkpoint ",
  "wiki lint-repo ",
  "wiki maintain ",
  "wiki update-index ",
  "wiki closeout ",
  "wiki sync ",
  "wiki refresh-from-git ",
  "wiki acknowledge-impact ",
  "wiki bind ",
  "wiki verify-page ",
] as const;

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
};

type TaskDocState = "missing" | "incomplete" | "ready";

export function buildForgeSteering(input: BuildForgeSteeringInput): ForgeSteeringPacket {
  const phase = input.nextPhase ?? "complete";

  if (!input.sliceId) {
    return {
      lane: "maintenance-refresh",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      ...(input.triage.loadSkill ? { loadSkill: input.triage.loadSkill } : {}),
    };
  }

  if (input.triage.kind === "resume-failed-forge") {
    return {
      lane: isMaintenanceRepairCommand(input.triage.command) ? "maintenance-refresh" : "verify-close",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    };
  }

  if (input.triage.kind === "completed") {
    return {
      lane: "maintenance-refresh",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    };
  }

  if (isPrePhaseTriage(input.triage)) {
    const lane = input.nextPhase === "tdd" ? "implementation-work" : "domain-work";
    const loadSkill = input.nextPhase === "tdd" ? "/tdd" : input.triage.loadSkill;
    return {
      lane,
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      ...(loadSkill ? { loadSkill } : {}),
    };
  }

  if (isForgeRunTriage(input.triage)) {
    return {
      lane: input.verificationLevel === "test-verified" ? "verify-close" : "implementation-work",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      ...(input.verificationLevel === "test-verified" ? {} : { loadSkill: "/tdd" }),
    };
  }

  if (input.planStatus !== "ready" || input.testPlanStatus !== "ready" || input.triage.kind === "fill-docs") {
    return {
      lane: "implementation-work",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      loadSkill: "/tdd",
    };
  }

  if (input.canonicalCompletion) {
    return {
      lane: "maintenance-refresh",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    };
  }

  if (input.verificationLevel === "test-verified") {
    return {
      lane: "verify-close",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
    };
  }

  return {
    lane: "implementation-work",
    phase,
    nextCommand: input.triage.command,
    why: input.triage.reason,
    ...(input.triage.loadSkill ? { loadSkill: input.triage.loadSkill } : {}),
  };
}

export function isMaintenanceRepairCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  return MAINTENANCE_REPAIR_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix));
}

export function renderSteeringPacket(steering: ForgeSteeringPacket): string[] {
  const lines = [
    `lane: ${steering.lane}`,
    `phase: ${steering.phase}`,
    `next: ${steering.nextCommand}`,
    `why: ${steering.why}`,
  ];
  if (steering.loadSkill) {
    lines.splice(2, 0, `load-skill: ${steering.loadSkill}`);
  }
  return lines;
}
