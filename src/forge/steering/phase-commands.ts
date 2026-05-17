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
          `hand off accepted findings into project truth, then bridge the slice with wiki research bridge <research-page> --project ${project} --slice ${sliceId}`,
        loadSkill: skill,
      };
    case "grill-with-docs":
      return {
        kind: "needs-grill-with-docs",
        reason: "workflow ledger shows the grill-with-docs phase is incomplete",
        command:
          `${skill} — ask one question at a time; read code/wiki before asking; ` +
          `write context to projects/${project}/architecture/domain-language.md or projects/${project}/architecture/contexts/<context>.md ` +
          `indexed by projects/${project}/architecture/context-map.md; ` +
          `write ADR bodies under projects/${project}/adrs/ and maintain projects/${project}/decisions.md as an index; ` +
          `prefer wiki forge grill record ${project} for stable refs`,
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
