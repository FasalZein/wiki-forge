export type OptimizeTarget = "workflow" | "skill";

export type WorkflowExample = {
  id: string;
  input: {
    project: string;
    stateSnapshot: string;
    currentOutput: string;
    repairContext: string;
    goal: string;
  };
  expected: {
    lane: string;
    nextCommand: string;
    forbiddenCommands?: string[];
    maxReasonLength?: number;
  };
};

export type SkillExample = {
  id: string;
  input: {
    skillName: string;
    taskBrief: string;
    currentSkill: string;
    acceptanceCriteria: string;
    repoContext: string;
  };
  expected: {
    mustInclude: string[];
    mustAvoid?: string[];
    maxRationaleLength?: number;
  };
};

export type TargetExample = WorkflowExample | SkillExample;

export type OptimizeConfig = {
  provider: string;
  baseURL: string | undefined;
  apiKey: string;
  model: string;
  teacherModel: string;
  headers: Record<string, string> | undefined;
};

export type ScoreCard = Record<string, number>;
