import { join } from "node:path";
import { VAULT_ROOT } from "../constants";
import {
  FORGE_PHASES,
  normalizeForgeLedger,
  readForgeLedgerPhase,
  writeForgeLedgerPhase,
  type ForgeWorkflowLedger,
  type ForgeWorkflowValidation,
} from "../lib/forge-ledger";
import { collectPriorResearchRefs, extractMarkdownSection, readMatterDoc, type MatterDoc } from "../lib/forge-evidence";
import { applyDerivedLedger } from "./forge-ledger-detect";
import type { BacklogTaskContext } from "../hierarchy";

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
  const researchRefs = collectPriorResearchRefs(input.prdDoc);
  return {
    project: input.project,
    sliceId: input.sliceId,
    ...(input.parentPrd ? { parentPrd: input.parentPrd } : {}),
    ...(researchRefs.length ? { research: { completedAt: readUpdated(input.prdDoc?.data), researchRefs } } : {}),
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
  for (const phase of FORGE_PHASES) {
    const phaseValue = phase === "domain-model" ? ledger["domain-model"] ?? ledger.grill : ledger[phase];
    if (phaseValue && typeof phaseValue === "object") {
      writeForgeLedgerPhase(out, phase, phaseValue);
    }
  }
  if (typeof ledger.parentPrd === "string") out.parentPrd = ledger.parentPrd;
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
  return merged;
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
  if (!docsReady || input.verificationLevel !== "test-verified") return validation;

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
