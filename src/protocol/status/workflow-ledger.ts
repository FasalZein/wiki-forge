export const FORGE_PHASES = ["research", "domain-model", "prd", "slices", "tdd", "verify"] as const;
export type ForgePhase = (typeof FORGE_PHASES)[number];
export const FORGE_WORKFLOW_PROFILES = ["full", "bootstrap"] as const;
export type ForgeWorkflowProfile = (typeof FORGE_WORKFLOW_PROFILES)[number];

// Only these phases may be skipped via `wiki forge skip` or `wiki forge run --skip-phase`.
// tdd and verify are the code-level enforcement floor for PRD-082 and cannot be waived by a reason string.
export const SKIPPABLE_FORGE_PHASES = ["research", "domain-model", "prd", "slices"] as const;
export type SkippableForgePhase = (typeof SKIPPABLE_FORGE_PHASES)[number];

export function isForgePhaseSkippable(phase: ForgePhase): phase is SkippableForgePhase {
  return (SKIPPABLE_FORGE_PHASES as readonly ForgePhase[]).includes(phase);
}

export type SkippedPhaseRecord = {
  phase: SkippableForgePhase;
  reason: string;
  skippedAt: string;
  skippedBy?: string;
};

const REQUIRED_PHASES_BY_PROFILE: Record<ForgeWorkflowProfile, ForgePhase[]> = {
  full: [...FORGE_PHASES],
  bootstrap: ["prd", "slices", "tdd", "verify"],
};

export type ForgeWorkflowLedger = {
  project: string;
  sliceId: string;
  workflowProfile?: ForgeWorkflowProfile;
  skippedPhases?: SkippedPhaseRecord[];
  parentPrd?: string;
  research?: {
    completedAt?: string;
    researchRefs?: string[];
  };
  "domain-model"?: {
    completedAt?: string;
    decisionRefs?: string[];
  };
  // Legacy storage key retained for historical authored ledgers.
  grill?: {
    completedAt?: string;
    decisionRefs?: string[];
  };
  prd?: {
    completedAt?: string;
    prdRef?: string;
    parentPrd?: string;
  };
  slices?: {
    completedAt?: string;
    sliceRefs?: string[];
  };
  tdd?: {
    completedAt?: string;
    tddEvidence?: string[];
  };
  verify?: {
    completedAt?: string;
    verificationCommands?: string[];
  };
};

export type ForgePhaseStatus = {
  phase: ForgePhase;
  completed: boolean;
  ready: boolean;
  missing: string[];
  blockedBy: ForgePhase[];
};

export type ForgeWorkflowValidation = {
  ok: boolean;
  nextPhase: ForgePhase | null;
  statuses: ForgePhaseStatus[];
};

type ForgeLedgerPhaseKey = "research" | "domain-model" | "prd" | "slices" | "tdd" | "verify";

export function forgeLedgerPhaseKey(phase: ForgePhase): ForgeLedgerPhaseKey {
  return phase === "domain-model" ? "domain-model" : phase;
}

export function readForgeLedgerPhase(ledger: Partial<ForgeWorkflowLedger>, phase: ForgePhase) {
  if (phase === "domain-model") {
    return (ledger["domain-model"] ?? ledger.grill) as Record<string, unknown> | undefined;
  }
  return ledger[forgeLedgerPhaseKey(phase)] as Record<string, unknown> | undefined;
}

export function writeForgeLedgerPhase(target: Partial<ForgeWorkflowLedger>, phase: ForgePhase, value: unknown) {
  const ledger = target as Record<string, unknown>;
  ledger[forgeLedgerPhaseKey(phase)] = value;
  if (phase === "domain-model") delete ledger.grill;
}

export function normalizeForgeLedger(ledger: Partial<ForgeWorkflowLedger>): Partial<ForgeWorkflowLedger> {
  const normalized: Partial<ForgeWorkflowLedger> = { ...ledger };
  const domainModel = readForgeLedgerPhase(ledger, "domain-model");
  if (domainModel) {
    normalized["domain-model"] = domainModel as ForgeWorkflowLedger["domain-model"];
  }
  delete (normalized as Record<string, unknown>).grill;
  return normalized;
}

export function normalizeForgeWorkflowProfile(value: unknown): ForgeWorkflowProfile {
  return value === "bootstrap" ? "bootstrap" : "full";
}

export function requiredForgePhases(profile: ForgeWorkflowProfile): ForgePhase[] {
  return REQUIRED_PHASES_BY_PROFILE[profile];
}

const PHASE_REQUIREMENTS: Record<ForgePhase, (ledger: ForgeWorkflowLedger) => string[]> = {
  research: (ledger) => {
    const missing: string[] = [];
    if (!ledger.research?.completedAt) missing.push("research.completedAt");
    if (!ledger.research?.researchRefs?.length) missing.push("research.researchRefs");
    return missing;
  },
  "domain-model": (ledger) => {
    const domainModel = readForgeLedgerPhase(ledger, "domain-model");
    const missing: string[] = [];
    if (!domainModel?.completedAt) missing.push("domain-model.completedAt");
    if (!Array.isArray(domainModel?.decisionRefs) || domainModel.decisionRefs.length === 0) missing.push("domain-model.decisionRefs");
    return missing;
  },
  prd: (ledger) => {
    const missing: string[] = [];
    if (!ledger.prd?.completedAt) missing.push("prd.completedAt");
    if (!ledger.prd?.prdRef) missing.push("prd.prdRef");
    if (!(ledger.prd?.parentPrd ?? ledger.parentPrd)) missing.push("prd.parentPrd");
    return missing;
  },
  slices: (ledger) => {
    const missing: string[] = [];
    if (!ledger.slices?.completedAt) missing.push("slices.completedAt");
    if (!ledger.slices?.sliceRefs?.length) missing.push("slices.sliceRefs");
    return missing;
  },
  tdd: (ledger) => {
    const missing: string[] = [];
    if (!ledger.tdd?.completedAt) missing.push("tdd.completedAt");
    if (!ledger.tdd?.tddEvidence?.length) missing.push("tdd.tddEvidence");
    return missing;
  },
  verify: (ledger) => {
    const missing: string[] = [];
    if (!ledger.verify?.completedAt) missing.push("verify.completedAt");
    if (!ledger.verify?.verificationCommands?.length) missing.push("verify.verificationCommands");
    return missing;
  },
};

export function validateForgeWorkflowLedger(ledger: ForgeWorkflowLedger): ForgeWorkflowValidation {
  const workflowProfile = normalizeForgeWorkflowProfile(ledger.workflowProfile);
  const requiredPhases = new Set(requiredForgePhases(workflowProfile));
  const skippedPhases = new Set(
    (ledger.skippedPhases ?? [])
      .map((entry) => entry?.phase)
      .filter((phase): phase is SkippableForgePhase => typeof phase === "string" && isForgePhaseSkippable(phase as ForgePhase)),
  );
  const statuses: ForgePhaseStatus[] = [];
  let previousIncomplete: ForgePhase[] = [];

  for (const phase of FORGE_PHASES) {
    if (!requiredPhases.has(phase) || skippedPhases.has(phase as SkippableForgePhase)) {
      statuses.push({
        phase,
        completed: true,
        ready: true,
        missing: [],
        blockedBy: [],
      });
      continue;
    }
    const missing = PHASE_REQUIREMENTS[phase](ledger);
    const completed = missing.length === 0 && previousIncomplete.length === 0;
    const ready = previousIncomplete.length === 0;
    const status: ForgePhaseStatus = {
      phase,
      completed,
      ready,
      missing,
      blockedBy: [...previousIncomplete],
    };
    statuses.push(status);
    if (!completed) previousIncomplete = [...previousIncomplete, phase];
  }

  return {
    ok: statuses.every((status) => status.completed),
    nextPhase: statuses.find((status) => !status.completed)?.phase ?? null,
    statuses,
  };
}

export function canAdvanceForgePhase(ledger: ForgeWorkflowLedger, phase: ForgePhase) {
  const validation = validateForgeWorkflowLedger(ledger);
  const status = validation.statuses.find((entry) => entry.phase === phase);
  if (!status) {
    return { ok: false, phase, missing: ["unknown phase"], blockedBy: [] as ForgePhase[] };
  }
  return {
    ok: status.ready && status.missing.length === 0,
    phase,
    missing: status.missing,
    blockedBy: status.blockedBy,
  };
}
