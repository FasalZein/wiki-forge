export const PRE_PHASE_TRIAGE_KINDS = [
  "needs-research",
  "needs-domain-model",
  "needs-prd",
  "needs-slices",
  "needs-tdd",
  "needs-verify",
] as const;

export type PrePhaseTriageKind = (typeof PRE_PHASE_TRIAGE_KINDS)[number];

export type ForgeTriageKind =
  | PrePhaseTriageKind
  | "fill-docs"
  | "completed"
  | "close-slice"
  | "open-slice"
  | "continue-active-slice"
  | "start-next-slice"
  | "plan-next"
  | "resume-failed-forge";

export type ForgeTriage = {
  kind: ForgeTriageKind;
  reason: string;
  command: string;
  loadSkill?: string;
};

const PRE_PHASE_TRIAGE_KIND_SET = new Set<string>(PRE_PHASE_TRIAGE_KINDS);
const FORGE_RUN_TRIAGE_KIND_SET = new Set<ForgeTriageKind>([
  "resume-failed-forge",
  "close-slice",
  "open-slice",
  "continue-active-slice",
  "start-next-slice",
]);

export function isPrePhaseTriage(triage: Pick<ForgeTriage, "kind">): triage is ForgeTriage & { kind: PrePhaseTriageKind } {
  return PRE_PHASE_TRIAGE_KIND_SET.has(triage.kind);
}

export function isForgeRunTriage(triage: Pick<ForgeTriage, "kind">): boolean {
  return FORGE_RUN_TRIAGE_KIND_SET.has(triage.kind);
}
