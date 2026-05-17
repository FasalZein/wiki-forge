export type PlanningSkill = "plan" | "torpathy" | "grill-with-docs" | "grill-me";

export type PlanningAnswer = {
  readonly id: string;
  readonly skill: PlanningSkill;
  readonly response: string;
  readonly recommendation?: string;
  readonly prdName?: string;
  readonly recordedAt: string;
};

export type PlanningPrdCandidate = {
  readonly name: string;
  readonly slices: readonly string[];
};

export type PlanningArtifacts = {
  readonly featureId: string;
  readonly prds: readonly {
    readonly prdId: string;
    readonly name: string;
    readonly slices: readonly string[];
  }[];
};

export type PlanningSession = {
  readonly project: string;
  readonly featureName: string;
  readonly sessionId: string;
  readonly status: "draft" | "ready-for-artifacts" | "artifacts-created";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly answers: readonly PlanningAnswer[];
  readonly prds: readonly PlanningPrdCandidate[];
  readonly artifacts?: PlanningArtifacts;
};
