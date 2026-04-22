import { loadConfig, phaseSkill } from "../../lib/config";
import type { ForgePhase } from "../status/workflow-ledger";
import type { ForgeTriage, PrePhaseTriageKind } from "./triage-types";

export type PhaseRecommendation = ForgeTriage & { kind: PrePhaseTriageKind };

export function phaseRecommendation(project: string, sliceId: string, nextPhase: ForgePhase, repo: string = process.cwd()): PhaseRecommendation {
  const skill = phaseSkill(loadConfig(repo), nextPhase).value;
  switch (nextPhase) {
    case "research":
      return {
        kind: "needs-research",
        reason: "workflow ledger shows research phase is incomplete",
        command:
          `${skill} — gather findings, choose a topic, file with wiki research file <topic> --project ${project} <title>, ` +
          `distill accepted findings into project truth, then bridge the slice with wiki research adopt <research-page> --project ${project} --slice ${sliceId}`,
        loadSkill: skill,
      };
    case "domain-model":
      return {
        kind: "needs-domain-model",
        reason: "workflow ledger shows the domain-model phase is incomplete",
        command:
          `${skill} — sharpen terms, append durable decisions to projects/${project}/decisions.md, ` +
          `update projects/${project}/architecture/domain-language.md, and surface ambiguities before PRD authoring`,
        loadSkill: skill,
      };
    case "prd":
      return {
        kind: "needs-prd",
        reason: "workflow ledger shows PRD phase is incomplete",
        command: `${skill} — create or complete the PRD for this feature`,
        loadSkill: skill,
      };
    case "slices":
      return {
        kind: "needs-slices",
        reason: "workflow ledger shows slice planning is incomplete",
        command: `${skill} — break the PRD into vertical slices`,
        loadSkill: skill,
      };
    case "tdd":
      return {
        kind: "needs-tdd",
        reason: "workflow ledger shows TDD phase is incomplete",
        command: `update projects/${project}/specs/slices/${sliceId}/test-plan.md with red tests`,
        loadSkill: skill,
      };
    case "verify":
      return {
        kind: "needs-verify",
        reason: "workflow ledger shows verification phase is incomplete",
        command: `wiki forge run ${project} ${sliceId} --repo <path>`,
        loadSkill: skill,
      };
  }
}
