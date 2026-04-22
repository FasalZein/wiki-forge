import { readVerificationLevel } from "../../lib/verification";
import { projectPrdsDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "../../lib/structure";
import { extractVerificationSpecsFromTestPlan } from "../../verification";
import {
  collectBacklogFocus,
  collectTaskContextForId,
  detectTaskDocState,
} from "../../hierarchy";
import { buildForgeSteering } from "../steering/packet";
import { extractMarkdownSection, readMatterDoc, readPlanningDoc } from "./evidence";
import { validateForgeWorkflowLedger } from "./workflow-ledger";
import {
  buildAuthoredForgeStatusLedger,
  collectDecisionRefs,
  normalizeForgeValidationForCloseableSlice,
  resolveForgeStatusLedger,
} from "./ledger";
import { buildForgeTriage } from "./triage";

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
  const verificationCommands = testPlan
    ? extractVerificationSpecsFromTestPlan(testPlan.content, testPlan.data).map((entry) => entry.command)
    : [];
  const planReady = await detectTaskDocState(projectTaskPlanPath(project, sliceId)) === "ready";
  const testPlanReady = await detectTaskDocState(projectTaskTestPlanPath(project, sliceId)) === "ready";
  const hasRedTestChecklist = /^\s*-\s*\[(?: |x|X)\]/mu.test(extractMarkdownSection(testPlan?.content ?? "", "Red Tests"));
  const tddReady = planReady && testPlanReady && hasRedTestChecklist && verificationCommands.length > 0;
  const authoredLedger = buildAuthoredForgeStatusLedger({
    project,
    sliceId,
    parentPrd,
    prdDoc,
    hub,
    plan,
    testPlan,
    tddReady,
    decisionRefs,
  });
  const ledger = await resolveForgeStatusLedger(authoredLedger, hub?.data?.forge_workflow_ledger, project, sliceId);
  const verificationLevel = testPlan ? readVerificationLevel(testPlan.data) : null;
  const validation = normalizeForgeValidationForCloseableSlice(
    validateForgeWorkflowLedger(ledger),
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
    canonicalCompletion: context?.canonicalCompletion ?? false,
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
      canonicalCompletion: context?.canonicalCompletion ?? false,
      }),
  };
}

export { compactForgeStatusForJson, compactWorkflowValidationForJson } from "./format";
export {
  buildAuthoredForgeStatusLedger,
  collectDecisionRefs,
  isSliceDocsReady,
  mergeAuthoredLedgers,
  normalizeForgeValidationForCloseableSlice,
  readAuthoredHubLedger,
  readUpdated,
  resolveForgeStatusLedger,
} from "./ledger";
export { buildForgeTriage } from "./triage";
export { applyDerivedLedger, deriveForgeLedgerFromArtifacts, mergeDerivedForgeLedger } from "./detect";
export { collectPriorResearchRefs, extractMarkdownSection, readMatterDoc, readPlanningDoc } from "./evidence";
export {
  FORGE_PHASES,
  canAdvanceForgePhase,
  forgeLedgerPhaseKey,
  normalizeForgeLedger,
  readForgeLedgerPhase,
  validateForgeWorkflowLedger,
  writeForgeLedgerPhase,
} from "./workflow-ledger";
export type { MatterDoc } from "./evidence";
export type { DetectionFinding, DerivedForgeLedger } from "./detect";
export type { ForgeTriageInput } from "./triage";
export type {
  ForgePhase,
  ForgePhaseStatus,
  ForgeWorkflowLedger,
  ForgeWorkflowValidation,
} from "./workflow-ledger";
