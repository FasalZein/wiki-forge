import { loadConfig, phaseSkill } from "../../lib/config";
import type { ForgePhase } from "../lifecycle/workflow-ledger";
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
        reason: "workflow ledger shows grill-with-docs phase is incomplete",
        command: `${skill} — resolve domain language and decisions, then record with wiki forge grill record ${project} --tag ${sliceId}. Writes: projects/${project}/architecture/domain-language.md, projects/${project}/architecture/context-map.md, projects/${project}/architecture/contexts/<context>.md, projects/${project}/adrs/, projects/${project}/decisions.md`,
        loadSkill: skill,
      };
    case "prd":
      return {
        kind: "needs-prd",
        reason: "workflow ledger shows PRD phase is incomplete",
        command: `${skill} — create or update the parent PRD, then record the PRD reference in the workflow ledger`,
        loadSkill: skill,
      };
    case "slices":
      return {
        kind: "needs-slices",
        reason: "workflow ledger shows slice breakdown is incomplete",
        command: `${skill} — create child slices, then record slice refs in the workflow ledger`,
        loadSkill: skill,
      };
    case "tdd":
      return {
        kind: "needs-tdd",
        reason: "workflow ledger shows TDD evidence is incomplete",
        command: `${skill} — create or update tests and record red/green evidence for ${sliceId}`,
        loadSkill: skill,
      };
    case "verify":
      return {
        kind: "needs-verify",
        reason: "workflow ledger shows verification evidence is incomplete",
        command: `run targeted verification for ${sliceId}, then record it with wiki forge evidence ${project} ${sliceId} verify --command "<cmd>"`,
        loadSkill: skill,
      };
  }
}
