import { join } from "node:path";
import { VAULT_ROOT } from "../constants";
import { readVerificationLevel } from "../lib/verification";
import {
  FORGE_PHASES,
  normalizeForgeLedger,
  readForgeLedgerPhase,
  writeForgeLedgerPhase,
  type ForgeWorkflowLedger,
  type ForgePhase,
  type ForgeWorkflowValidation,
  validateForgeWorkflowLedger,
} from "../lib/forge-ledger";
import { applyDerivedLedger } from "../lib/forge-ledger-detect";
import { buildForgeSteering } from "../lib/forge-steering";
import { type ForgeTriage } from "../lib/forge-triage";
import { collectPriorResearchRefs, extractMarkdownSection, readMatterDoc, readPlanningDoc, type MatterDoc } from "../lib/forge-evidence";
import { projectPrdsDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "../lib/structure";
import {
  type BacklogTaskContext,
  collectBacklogFocus,
  collectTaskContextForId,
  detectTaskDocState,
} from "../hierarchy";
import { classifyWorkflowSteeringTriage } from "./steering-triage";

type TaskDocState = BacklogTaskContext["planStatus"];

type ForgeTriageInput = {
  activeSlice: string | null;
  sliceStatus: string | null;
  section: string | null;
  planStatus: string;
  testPlanStatus: string;
  verificationLevel: string | null;
  nextPhase: ForgePhase | null;
  repo?: string;
};

export function isSliceDocsReady(task: Pick<BacklogTaskContext, "planStatus" | "testPlanStatus"> | null | undefined) {
  return task?.planStatus === "ready" && task.testPlanStatus === "ready";
}

export async function collectForgeStatus(project: string, sliceId: string, repo?: string) {
  const [focus, context, hub, plan, testPlan, decisionRefs] = await Promise.all([
    collectBacklogFocus(project),
    collectTaskContextForId(project, sliceId),
    readMatterDoc(projectTaskHubPath(project, sliceId)),
    readMatterDoc(projectTaskPlanPath(project, sliceId)),
    readMatterDoc(projectTaskTestPlanPath(project, sliceId)),
    collectDecisionRefs(project),
  ]);
  const parentPrd = typeof hub?.data.parent_prd === "string" ? hub.data.parent_prd : undefined;
  const parentFeature = typeof hub?.data.parent_feature === "string" ? hub.data.parent_feature : undefined;
  const prdDoc = parentPrd ? await readPlanningDoc(projectPrdsDir(project), parentPrd) : null;
  const researchRefs = collectPriorResearchRefs(prdDoc);
  const verificationCommands = Array.isArray(testPlan?.data.verification_commands)
    ? testPlan.data.verification_commands
      .map((entry: unknown) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).command === "string" ? String((entry as Record<string, unknown>).command) : null)
      .filter((value: string | null): value is string => Boolean(value))
    : [];
  const planReady = await detectTaskDocState(projectTaskPlanPath(project, sliceId)) === "ready";
  const testPlanReady = await detectTaskDocState(projectTaskTestPlanPath(project, sliceId)) === "ready";
  const hasRedTestChecklist = /^\s*-\s*\[(?: |x|X)\]/mu.test(extractMarkdownSection(testPlan?.content ?? "", "Red Tests"));
  const tddReady = planReady && testPlanReady && hasRedTestChecklist && verificationCommands.length > 0;
  const authoredLedger: Partial<ForgeWorkflowLedger> = {
    project,
    sliceId,
    ...(parentPrd ? { parentPrd } : {}),
    ...(researchRefs.length ? { research: { completedAt: readUpdated(prdDoc?.data), researchRefs } } : {}),
    ...(decisionRefs.length ? { "domain-model": { completedAt: decisionRefs[0].completedAt, decisionRefs: decisionRefs.map((entry: { ref: string }) => entry.ref) } } : {}),
    ...(prdDoc && parentPrd ? { prd: { completedAt: readUpdated(prdDoc.data), prdRef: parentPrd, parentPrd } } : {}),
    ...(hub && plan && testPlan ? { slices: { completedAt: readUpdated(hub.data), sliceRefs: [sliceId] } } : {}),
    ...(tddReady ? { tdd: { completedAt: readUpdated(testPlan?.data), tddEvidence: [`projects/${project}/specs/slices/${sliceId}/test-plan.md#red-tests`] } } : {}),
  };
  const hubLedger = readAuthoredHubLedger(hub?.data?.forge_workflow_ledger, project, sliceId);
  const mergedAuthoredLedger = mergeAuthoredLedgers(authoredLedger, hubLedger);
  let ledger: Partial<ForgeWorkflowLedger>;
  try {
    const { merged } = await applyDerivedLedger(mergedAuthoredLedger, project, sliceId);
    ledger = normalizeForgeLedger(merged);
  } catch {
    ledger = normalizeForgeLedger(mergedAuthoredLedger);
  }
  const verificationLevel = testPlan ? readVerificationLevel(testPlan.data) : null;
  const validation = normalizeForgeValidationForCloseableSlice(
    validateForgeWorkflowLedger(ledger as ForgeWorkflowLedger),
    {
      planStatus: context?.planStatus ?? "missing",
      testPlanStatus: context?.testPlanStatus ?? "missing",
      verificationLevel,
    },
  );
  const triage = buildForgeTriage(project, sliceId, {
    activeSlice: focus.activeTask?.id ?? null,
    sliceStatus: context?.sliceStatus ?? null,
    section: context?.section ?? null,
    planStatus: context?.planStatus ?? "missing",
    testPlanStatus: context?.testPlanStatus ?? "missing",
    verificationLevel,
    nextPhase: validation.nextPhase ?? null,
    repo,
  });
  return {
    project,
    sliceId,
    activeSlice: focus.activeTask?.id ?? null,
    recommendedSlice: focus.recommendedTask?.id ?? null,
    context,
    parentPrd: parentPrd ?? null,
    parentFeature: parentFeature ?? null,
    planStatus: context?.planStatus ?? "missing",
    testPlanStatus: context?.testPlanStatus ?? "missing",
    verificationLevel,
    workflow: {
      ledger,
      validation,
    },
    triage,
    steering: buildForgeSteering({
      project,
      sliceId,
      triage,
      nextPhase: validation.nextPhase ?? null,
      planStatus: context?.planStatus ?? "missing",
      testPlanStatus: context?.testPlanStatus ?? "missing",
      verificationLevel,
      sliceStatus: context?.sliceStatus ?? null,
      section: context?.section ?? null,
    }),
  };
}

export function buildForgeTriage(project: string, sliceId: string, input: ForgeTriageInput): ForgeTriage {
  return classifyWorkflowSteeringTriage({
    project,
    repo: input.repo ?? "<path>",
    base: undefined,
    activeTask: input.activeSlice ? { id: input.activeSlice } : null,
    nextTask: null,
    targetTask: {
      id: sliceId,
      planStatus: input.planStatus as TaskDocState,
      testPlanStatus: input.testPlanStatus as TaskDocState,
      ...(input.sliceStatus ? { sliceStatus: input.sliceStatus } : {}),
      ...(input.section ? { section: input.section } : {}),
    },
    workflowNextPhase: input.nextPhase,
    verificationLevel: input.verificationLevel,
    targetSliceStatus: input.sliceStatus,
    targetSection: input.section,
  });
}

export function compactForgeStatusForJson(workflow: Awaited<ReturnType<typeof collectForgeStatus>>) {
  const { context, ...rest } = workflow;
  return {
    ...rest,
    workflow: {
      ...workflow.workflow,
      ledger: normalizeForgeLedger(workflow.workflow.ledger),
      validation: {
        ...workflow.workflow.validation,
        statuses: workflow.workflow.validation.statuses.map((status) => ({
          ...status,
          unmet: status.missing,
        })),
      },
    },
    context: context
      ? {
          id: context.id,
          title: context.title,
          section: context.section,
          assignee: context.assignee,
          sliceStatus: context.sliceStatus,
          planStatus: context.planStatus,
          testPlanStatus: context.testPlanStatus,
          dependencies: context.dependencies,
          blockedBy: context.blockedBy,
        }
      : null,
    steering: workflow.steering,
  };
}

async function collectDecisionRefs(project: string) {
  const decisionsPath = join(VAULT_ROOT, "projects", project, "decisions.md");
  const decisions = await readMatterDoc(decisionsPath);
  if (!decisions) return [] as Array<{ ref: string; completedAt: string }>;
  const body = extractMarkdownSection(decisions.content, "Current Decisions");
  const hasEntries = body.split("\n").some((line) => /^-\s+/u.test(line.trim()));
  return hasEntries ? [{ ref: `projects/${project}/decisions.md#current-decisions`, completedAt: readUpdated(decisions.data) }] : [];
}

function readUpdated(data: Record<string, unknown> | undefined) {
  const value = data?.updated ?? data?.started_at ?? data?.created_at;
  return typeof value === "string" && value.trim() ? value : new Date(0).toISOString();
}

function readAuthoredHubLedger(value: unknown, project: string, sliceId: string): Partial<ForgeWorkflowLedger> {
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

function mergeAuthoredLedgers(
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

function normalizeForgeValidationForCloseableSlice(
  validation: ForgeWorkflowValidation,
  input: Pick<ForgeTriageInput, "planStatus" | "testPlanStatus" | "verificationLevel">,
): ForgeWorkflowValidation {
  const docsReady = isSliceDocsReady({
    planStatus: input.planStatus as TaskDocState,
    testPlanStatus: input.testPlanStatus as TaskDocState,
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
