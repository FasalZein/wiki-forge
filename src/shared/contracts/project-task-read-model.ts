export type ProjectTaskDocState = "missing" | "incomplete" | "ready";

export type ProjectBacklogItem = {
  raw: string;
  id: string;
  title: string;
};

export type ProjectTaskContext = {
  id: string;
  title: string;
  section: string;
  assignee: string | null;
  sliceStatus: string | null;
  completedAt: string | null;
  canonicalCompletion: boolean;
  taskHubPath?: string;
  planPath?: string;
  testPlanPath?: string;
  hasSliceDocs: boolean;
  planStatus: ProjectTaskDocState;
  testPlanStatus: ProjectTaskDocState;
  dependencies: string[];
  blockedBy: string[];
};

export type ProjectBacklogFocus = {
  project: string;
  activeTask: ProjectTaskContext | null;
  recommendedTask: ProjectTaskContext | null;
  inProgress: ProjectBacklogItem[];
  todo: ProjectBacklogItem[];
  warnings: string[];
  blocked: Array<{ id: string; blockedBy: string[] }>;
};
