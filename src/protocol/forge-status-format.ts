import { normalizeForgeLedger, type ForgeWorkflowLedger, type ForgeWorkflowValidation } from "../lib/forge-ledger";
import type { BacklogTaskContext } from "../hierarchy";

type CompactableForgeStatus = {
  context: BacklogTaskContext | null;
  workflow: {
    ledger: Partial<ForgeWorkflowLedger>;
    validation: ForgeWorkflowValidation;
  };
  steering: unknown;
};

export function compactWorkflowValidationForJson(validation: ForgeWorkflowValidation) {
  return {
    ...validation,
    statuses: validation.statuses.map((status) => ({
      ...status,
      unmet: status.missing,
    })),
  };
}

export function compactForgeStatusForJson<T extends CompactableForgeStatus>(workflow: T) {
  const { context, ...rest } = workflow;
  return {
    ...rest,
    workflow: {
      ...workflow.workflow,
      ledger: normalizeForgeLedger(workflow.workflow.ledger),
      validation: compactWorkflowValidationForJson(workflow.workflow.validation),
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
