import type { ForgePhase } from "./forge-ledger";
import { isPrePhaseTriage, type ForgeTriage } from "./forge-triage";

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
      lane: "verify-close",
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

  if (input.planStatus !== "ready" || input.testPlanStatus !== "ready" || input.triage.kind === "fill-docs") {
    return {
      lane: "implementation-work",
      phase,
      nextCommand: input.triage.command,
      why: input.triage.reason,
      loadSkill: "/tdd",
    };
  }

  if (input.sliceStatus === "done" || input.section === "Done") {
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
    nextCommand: `wiki forge next ${input.project} --prompt`,
    why: `verification level is ${input.verificationLevel ?? "missing"}; finish /tdd work before verify-close`,
    loadSkill: "/tdd",
  };
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
