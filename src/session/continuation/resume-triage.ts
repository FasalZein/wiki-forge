import { phaseRecommendation, type ForgePhase, type ForgeTriage } from "../../protocol/steering/index";

type ResumeTaskRef = { id: string } | null | undefined;

export type ResumeTriageContext = {
  project: string;
  repo: string;
  base: string | undefined;
  activeTask: ResumeTaskRef;
  nextTask: ResumeTaskRef;
  handoff?: { lastForgeRun?: string; lastForgeStep?: string; lastForgeOk?: boolean; nextAction?: string; failureSummary?: string } | null;
  workflowNextPhase?: ForgePhase | null;
  verificationLevel?: string | null;
};

type TriageRule = {
  kind: ForgeTriage["kind"];
  priority: number;
  when: (context: ResumeTriageContext) => boolean;
  build: (context: ResumeTriageContext) => ForgeTriage;
};

export const TRIAGE_RULES: TriageRule[] = [
  {
    kind: "resume-failed-forge",
    priority: 10,
    when: (context) => {
      const { activeTask, handoff, workflowNextPhase } = context;
      if (!activeTask || !handoff || handoff.lastForgeOk !== false || !handoff.nextAction) return false;
      if (workflowNextPhase && workflowNextPhase !== "verify") return false;
      return true;
    },
    build: ({ handoff }) => ({
      kind: "resume-failed-forge",
      reason: handoff?.failureSummary ?? `forge run failed at ${handoff?.lastForgeStep}`,
      command: handoff!.nextAction!,
    }),
  },
  {
    kind: "needs-research",
    priority: 20,
    when: ({ activeTask, nextTask, workflowNextPhase }) => Boolean((activeTask ?? nextTask) && workflowNextPhase && workflowNextPhase !== "verify"),
    build: ({ project, repo, activeTask, nextTask, workflowNextPhase }) => phaseRecommendation(project, (activeTask ?? nextTask)!.id, workflowNextPhase!, repo),
  },
  {
    kind: "continue-active-slice",
    priority: 30,
    when: ({ activeTask }) => Boolean(activeTask),
    build: ({ project, repo, base, activeTask }) => ({
      kind: "continue-active-slice",
      reason: `active slice ${activeTask!.id} is the current focus`,
      command: `wiki forge run ${project} ${activeTask!.id} --repo ${repo}${base ? ` --base ${base}` : ""}`,
    }),
  },
  {
    kind: "start-next-slice",
    priority: 40,
    when: ({ nextTask }) => Boolean(nextTask),
    build: ({ project, repo, base, nextTask }) => ({
      kind: "start-next-slice",
      reason: `no slice is active; ${nextTask!.id} is the next queued slice`,
      command: `wiki forge run ${project} ${nextTask!.id} --repo ${repo}${base ? ` --base ${base}` : ""}`,
    }),
  },
  {
    kind: "plan-next",
    priority: 50,
    when: () => true,
    build: ({ project }) => ({
      kind: "plan-next",
      reason: "no active or ready slice was found",
      command: `wiki forge next ${project}`,
    }),
  },
];

export function classifyResumeTriage(context: ResumeTriageContext): ForgeTriage {
  const rule = [...TRIAGE_RULES]
    .sort((left, right) => left.priority - right.priority)
    .find((candidate) => candidate.when(context));
  return (rule ?? TRIAGE_RULES[TRIAGE_RULES.length - 1]!).build(context);
}
