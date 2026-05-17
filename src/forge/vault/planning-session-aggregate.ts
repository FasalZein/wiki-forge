import {
  addPlanningPrd,
  addPlanningSlice,
  completePlanningSession,
  createPlanningArtifacts,
  evaluatePlanningSessionGate,
  readPlanningSession,
  recordPlanningAnswer,
  type PlanningArtifacts,
  type PlanningSession,
  type PlanningSessionGate,
} from "./planning-session-store";

export type PlanningSessionAggregateContext = {
  readonly project: string;
  readonly featureName: string;
  readonly vaultRoot?: string;
};

export type PlanningSessionInspection = {
  readonly session: PlanningSession | null;
  readonly gate: PlanningSessionGate;
};

export type PlanningSessionArtifactCreation = {
  readonly session: PlanningSession;
  readonly artifacts: PlanningArtifacts;
};

export type PlanningSessionAggregate = {
  readonly recordPlan: (input: RecordPlanningSessionPlanInput) => Promise<PlanningSession>;
  readonly addPrd: (prdName: string) => Promise<PlanningSession>;
  readonly addSlice: (prdName: string, sliceTitle: string) => Promise<PlanningSession>;
  readonly complete: () => Promise<{ readonly session: PlanningSession; readonly gate: PlanningSessionGate }>;
  readonly createArtifacts: () => Promise<PlanningSessionArtifactCreation>;
  readonly inspect: () => Promise<PlanningSessionInspection>;
};

export type RecordPlanningSessionPlanInput = {
  readonly answerId?: string;
  readonly response: string;
  readonly recommendation?: string;
};

export function createPlanningSessionAggregate(context: PlanningSessionAggregateContext): PlanningSessionAggregate {
  const base = {
    project: context.project,
    featureName: context.featureName,
    ...(context.vaultRoot ? { vaultRoot: context.vaultRoot } : {}),
  };

  return {
    recordPlan(input) {
      return recordPlanningAnswer({
        ...base,
        skill: "plan",
        answerId: input.answerId ?? "plan",
        response: input.response,
        ...(input.recommendation ? { recommendation: input.recommendation } : {}),
      });
    },
    addPrd(prdName) {
      return addPlanningPrd({ ...base, prdName });
    },
    addSlice(prdName, sliceTitle) {
      return addPlanningSlice({ ...base, prdName, sliceTitle });
    },
    complete() {
      return completePlanningSession(base);
    },
    createArtifacts() {
      return createPlanningArtifacts(base);
    },
    async inspect() {
      const session = await readPlanningSession(context.project, context.featureName, context.vaultRoot);
      return { session, gate: evaluatePlanningSessionGate(session) };
    },
  };
}
