import type { ScoreCard, SkillExample, WorkflowExample } from "./types";

function normalizeCommand(command: string | undefined) {
  return (command || "").trim().replace(/\s+/g, " ");
}

export async function workflowMetric({
  prediction,
  example,
}: {
  prediction: Record<string, unknown>;
  example: WorkflowExample;
}): Promise<ScoreCard> {
  const nextCommand = normalizeCommand(typeof prediction.nextCommand === "string" ? prediction.nextCommand : "");
  const expectedCommand = normalizeCommand(example.expected.nextCommand);
  const lane = typeof prediction.lane === "string" ? prediction.lane : "";
  const blockerType = typeof prediction.blockerType === "string" ? prediction.blockerType : "";
  const reason = typeof prediction.reason === "string" ? prediction.reason : "";
  const compactResponse = typeof prediction.compactResponse === "string" ? prediction.compactResponse : "";

  const forbiddenHit = (example.expected.forbiddenCommands || [])
    .map((command) => normalizeCommand(command))
    .some((command) => command && nextCommand.includes(command));
  const maxReasonLength = example.expected.maxReasonLength ?? 140;

  return {
    blockerAccuracy: blockerType === example.expected.blockerType ? 1 : 0,
    laneAccuracy: lane === example.expected.lane ? 1 : 0,
    commandAccuracy: nextCommand === expectedCommand ? 1 : 0,
    noLoop: forbiddenHit ? 0 : 1,
    reasonBrevity: reason.length > 0 && reason.length <= maxReasonLength ? 1 : 0.25,
    compactness: compactResponse.length > 0 && compactResponse.length <= 280 ? 1 : 0.25,
  };
}

export async function skillMetric({
  prediction,
  example,
}: {
  prediction: Record<string, unknown>;
  example: SkillExample;
}): Promise<ScoreCard> {
  const revisedSkill = typeof prediction.revisedSkill === "string" ? prediction.revisedSkill : "";
  const rationale = typeof prediction.rationale === "string" ? prediction.rationale : "";
  const rolloutNote = typeof prediction.rolloutNote === "string" ? prediction.rolloutNote : "";
  const mustIncludeHits = example.expected.mustInclude.filter((needle) => revisedSkill.includes(needle)).length;
  const mustAvoidHits = (example.expected.mustAvoid || []).filter((needle) => revisedSkill.includes(needle)).length;
  const maxRationaleLength = example.expected.maxRationaleLength ?? 220;

  return {
    preserveRequiredContent: example.expected.mustInclude.length === 0
      ? 1
      : mustIncludeHits / example.expected.mustInclude.length,
    avoidForbiddenContent: mustAvoidHits === 0 ? 1 : 0,
    rationaleBrevity: rationale.length > 0 && rationale.length <= maxRationaleLength ? 1 : 0.25,
    mentionsReloadFlow: rolloutNote.includes("sync:local") && rolloutNote.toLowerCase().includes("restart") ? 1 : 0,
  };
}
