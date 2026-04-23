import { join } from "node:path";
import { TEST_VERIFIED_LEVEL, VAULT_ROOT } from "../../constants";
import {
  FORGE_PHASES,
  isForgePhaseSkippable,
  normalizeForgeLedger,
  normalizeForgeWorkflowProfile,
  readForgeLedgerPhase,
  writeForgeLedgerPhase,
  type ForgePhase,
  type SkippableForgePhase,
  type SkippedPhaseRecord,
  type ForgeWorkflowLedger,
  type ForgeWorkflowValidation,
} from "./workflow-ledger";
import { extractMarkdownSection, readMatterDoc, type MatterDoc } from "./evidence";
import { applyDerivedLedger } from "./detect";
import type { BacklogTaskContext } from "../../hierarchy";

type TaskDocState = BacklogTaskContext["planStatus"];

type ForgeDecisionRef = {
  ref: string;
  completedAt: string;
};

type BuildAuthoredForgeStatusLedgerInput = {
  project: string;
  sliceId: string;
  parentPrd?: string;
  prdDoc: MatterDoc | null;
  hub: MatterDoc | null;
  plan: MatterDoc | null;
  testPlan: MatterDoc | null;
  tddReady: boolean;
  decisionRefs: ForgeDecisionRef[];
};

export function isSliceDocsReady(task: Pick<BacklogTaskContext, "planStatus" | "testPlanStatus"> | null | undefined) {
  return task?.planStatus === "ready" && task.testPlanStatus === "ready";
}

export async function collectDecisionRefs(project: string): Promise<ForgeDecisionRef[]> {
  const decisionsPath = join(VAULT_ROOT, "projects", project, "decisions.md");
  const decisions = await readMatterDoc(decisionsPath);
  if (!decisions) return [];
  const body = extractMarkdownSection(decisions.content, "Current Decisions");
  const hasEntries = body.split("\n").some((line) => /^-\s+/u.test(line.trim()));
  return hasEntries ? [{ ref: `projects/${project}/decisions.md#current-decisions`, completedAt: readUpdated(decisions.data) }] : [];
}

export function buildAuthoredForgeStatusLedger(input: BuildAuthoredForgeStatusLedgerInput): Partial<ForgeWorkflowLedger> {
  return {
    project: input.project,
    sliceId: input.sliceId,
    workflowProfile: normalizeForgeWorkflowProfile(input.hub?.data.workflow_profile),
    ...(input.parentPrd ? { parentPrd: input.parentPrd } : {}),
    ...(input.decisionRefs.length
      ? {
          "domain-model": {
            completedAt: input.decisionRefs[0].completedAt,
            decisionRefs: input.decisionRefs.map((entry) => entry.ref),
          },
        }
      : {}),
    ...(input.prdDoc && input.parentPrd
      ? { prd: { completedAt: readUpdated(input.prdDoc.data), prdRef: input.parentPrd, parentPrd: input.parentPrd } }
      : {}),
    ...(input.hub && input.plan && input.testPlan ? { slices: { completedAt: readUpdated(input.hub.data), sliceRefs: [input.sliceId] } } : {}),
    ...(input.tddReady
      ? {
          tdd: {
            completedAt: readUpdated(input.testPlan?.data),
            tddEvidence: [`projects/${input.project}/specs/slices/${input.sliceId}/test-plan.md#red-tests`],
          },
        }
      : {}),
  };
}

export async function resolveForgeStatusLedger(
  authoredLedger: Partial<ForgeWorkflowLedger>,
  hubLedgerValue: unknown,
  project: string,
  sliceId: string,
): Promise<ForgeWorkflowLedger> {
  const hubLedger = readAuthoredHubLedger(hubLedgerValue, project, sliceId);
  const mergedAuthoredLedger = mergeAuthoredLedgers(authoredLedger, hubLedger);
  try {
    const { merged } = await applyDerivedLedger(mergedAuthoredLedger, project, sliceId);
    return normalizeForgeLedger(merged) as ForgeWorkflowLedger;
  } catch {
    return normalizeForgeLedger(mergedAuthoredLedger) as ForgeWorkflowLedger;
  }
}

export function readUpdated(data: Record<string, unknown> | undefined) {
  const value = data?.updated ?? data?.started_at ?? data?.created_at;
  return typeof value === "string" && value.trim() ? value : new Date(0).toISOString();
}

export function readAuthoredHubLedger(value: unknown, project: string, sliceId: string): Partial<ForgeWorkflowLedger> {
  if (!value || typeof value !== "object") return { project, sliceId };
  const ledger = value as Record<string, unknown>;
  const out: Partial<ForgeWorkflowLedger> = { project, sliceId };
  if (typeof ledger.workflowProfile === "string" || typeof ledger.workflow_profile === "string") {
    out.workflowProfile = normalizeForgeWorkflowProfile(ledger.workflowProfile ?? ledger.workflow_profile);
  }
  for (const phase of FORGE_PHASES) {
    const phaseValue = phase === "domain-model" ? ledger["domain-model"] ?? ledger.grill : ledger[phase];
    if (phaseValue && typeof phaseValue === "object") {
      writeForgeLedgerPhase(out, phase, phaseValue);
    }
  }
  if (typeof ledger.parentPrd === "string") out.parentPrd = ledger.parentPrd;
  const skipped = coerceSkippedPhases(ledger.skippedPhases ?? ledger.skipped_phases);
  if (skipped.length) out.skippedPhases = skipped;
  return out;
}

export function mergeAuthoredLedgers(
  base: Partial<ForgeWorkflowLedger>,
  override: Partial<ForgeWorkflowLedger>,
): Partial<ForgeWorkflowLedger> {
  const merged: Partial<ForgeWorkflowLedger> = { ...base, ...override };
  for (const phase of FORGE_PHASES) {
    const basePhase = readForgeLedgerPhase(base, phase);
    const overridePhase = readForgeLedgerPhase(override, phase);
    if (basePhase || overridePhase) {
      writeForgeLedgerPhase(merged, phase, { ...(basePhase ?? {}), ...(overridePhase ?? {}) });
    }
  }
  const skipped = mergeSkippedPhases(base.skippedPhases, override.skippedPhases);
  if (skipped.length) merged.skippedPhases = skipped;
  else delete merged.skippedPhases;
  return merged;
}

function coerceSkippedPhases(raw: unknown): SkippedPhaseRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<SkippableForgePhase, SkippedPhaseRecord>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const phase = rec.phase;
    if (typeof phase !== "string" || !isForgePhaseSkippable(phase as ForgePhase)) continue;
    const reason = typeof rec.reason === "string" ? rec.reason.trim() : "";
    if (!reason) continue;
    const skippedAt = typeof rec.skippedAt === "string" && rec.skippedAt.trim() ? rec.skippedAt : new Date(0).toISOString();
    const skippedBy = typeof rec.skippedBy === "string" && rec.skippedBy.trim() ? rec.skippedBy : undefined;
    seen.set(phase as SkippableForgePhase, skippedBy
      ? { phase: phase as SkippableForgePhase, reason, skippedAt, skippedBy }
      : { phase: phase as SkippableForgePhase, reason, skippedAt });
  }
  return [...seen.values()];
}

function mergeSkippedPhases(
  base: SkippedPhaseRecord[] | undefined,
  override: SkippedPhaseRecord[] | undefined,
): SkippedPhaseRecord[] {
  const out = new Map<SkippableForgePhase, SkippedPhaseRecord>();
  for (const entry of base ?? []) out.set(entry.phase, entry);
  for (const entry of override ?? []) out.set(entry.phase, entry);
  return [...out.values()];
}

export function normalizeForgeValidationForCloseableSlice(
  validation: ForgeWorkflowValidation,
  input: {
    planStatus: TaskDocState;
    testPlanStatus: TaskDocState;
    verificationLevel: string | null;
  },
): ForgeWorkflowValidation {
  const docsReady = isSliceDocsReady({
    planStatus: input.planStatus,
    testPlanStatus: input.testPlanStatus,
  });
  if (!docsReady || input.verificationLevel !== TEST_VERIFIED_LEVEL) return validation;

  return {
    ok: true,
    nextPhase: null,
    statuses: validation.statuses.map((status) => ({
      ...status,
      completed: true,
      ready: true,
      missing: [],
      blockedBy: [],
    })),
  };
}
