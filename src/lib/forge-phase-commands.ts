import type { ForgePhase } from "./forge-ledger";

export type PhaseRecommendation = {
  kind: string;
  reason: string;
  command: string;
};

export function phaseRecommendation(project: string, sliceId: string, nextPhase: ForgePhase): PhaseRecommendation {
  switch (nextPhase) {
    case "research":
      return {
        kind: "needs-research",
        reason: "workflow ledger shows research phase is incomplete",
        command: `/research — gather findings and file with wiki research file ${project}`,
      };
    case "grill":
      return {
        kind: "needs-grill",
        reason: "workflow ledger shows the domain-model phase is incomplete",
        command: `/domain-model — sharpen terms, record decisions in the wiki, and surface ambiguities before PRD authoring`,
      };
    case "prd":
      return {
        kind: "needs-prd",
        reason: "workflow ledger shows PRD phase is incomplete",
        command: `/write-a-prd — create or complete the PRD for this feature`,
      };
    case "slices":
      return {
        kind: "needs-slices",
        reason: "workflow ledger shows slice planning is incomplete",
        command: `/prd-to-slices — break the PRD into vertical slices`,
      };
    case "tdd":
      return {
        kind: "needs-tdd",
        reason: "workflow ledger shows TDD phase is incomplete",
        command: `update projects/${project}/specs/slices/${sliceId}/test-plan.md with red tests`,
      };
    case "verify":
      return {
        kind: "needs-verify",
        reason: "workflow ledger shows verification phase is incomplete",
        command: `wiki forge run ${project} ${sliceId} --repo <path>`,
      };
  }
}
