import type { V1HandoverRecord } from "./schema";

export function renderV1HandoverMarkdown(handover: V1HandoverRecord): string {
  return [
    "---",
    `title: ${quoteScalar(handover.title)}`,
    `project: ${quoteScalar(handover.project)}`,
    "type: forge-handover",
    `session_id: ${quoteScalar(handover.sessionId)}`,
    `created_at: ${quoteScalar(handover.createdAt)}`,
    `agent: ${quoteScalar(handover.agent)}`,
    renderStringList("related_features", handover.relatedFeatures),
    renderStringList("related_prds", handover.relatedPrds),
    renderStringList("related_slices", handover.relatedSlices),
    `next_action: ${quoteScalar(handover.nextAction)}`,
    "---",
    `# ${handover.title}`,
    "",
    "## Summary",
    "",
    handover.summary,
    "",
    "## Related workflow",
    "",
    ...handover.relatedFeatures.map((feature) => `- Feature: ${feature}`),
    ...handover.relatedPrds.map((prd) => `- PRD: ${prd}`),
    ...handover.relatedSlices.map((slice) => `- Slice: ${slice}`),
    "",
    "## Next action",
    "",
    handover.nextAction,
    "",
    "## Copy/paste prompt for next session",
    "",
    "```text",
    handover.copyPastePrompt,
    "```",
  ].join("\n");
}

function renderStringList(key: string, values: readonly string[]): string {
  if (values.length === 0) return `${key}: []`;
  return [`${key}:`, ...values.map((value) => `  - ${quoteScalar(value)}`)].join("\n");
}

function quoteScalar(value: string): string {
  return JSON.stringify(value);
}
