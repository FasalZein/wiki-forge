import type { ForgeHandoverRecord } from "./schema";

export type HandoverPromptInput = {
  readonly project: string;
  readonly summary: string;
  readonly nextAction: string;
  readonly operatorPrompt: string;
  readonly relatedPrds: readonly string[];
  readonly relatedSlices: readonly string[];
  readonly runbookCommands?: readonly string[];
  readonly repo?: string;
  readonly base?: string;
};

export function renderForgeHandoverMarkdown(handover: ForgeHandoverRecord): string {
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
    ...(handover.baseRevision ? [`base_revision: ${quoteScalar(handover.baseRevision)}`] : []),
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
    ...renderRelatedWorkflow(handover),
    "",
    "## Context refresh required",
    "",
    "Before following the next action, use wiki query to re-anchor on current durable memory, then confirm Forge workflow truth:",
    "",
    "```bash",
    ...renderWikiQueryCommands({
      project: handover.project,
      relatedPrds: handover.relatedPrds,
      relatedSlices: handover.relatedSlices,
    }),
    "```",
    "",
    "## Next action",
    "",
    handover.nextAction,
    "",
    ...renderRunbookSection(handover.runbookCommands),
    "## Operator prompt",
    "",
    handover.copyPastePrompt,
  ].join("\n");
}

export function renderStructuredHandoverPrompt(input: HandoverPromptInput): string {
  return [
    `Continue ${input.project} from this handover, but treat it as a starting hypothesis until refreshed.`,
    "",
    "Context refresh — run these first and read the hits before changing files:",
    ...renderWikiQueryCommands(input).map((command) => `- ${command}`),
    `- wiki checkpoint ${input.project} --repo ${quoteShell(input.repo ?? ".")} --base ${quoteShell(input.base ?? "HEAD")}`,
    `- wiki forge next ${input.project} --repo ${quoteShell(input.repo ?? ".")}`,
    ...renderStatusCommands(input).map((command) => `- ${command}`),
    ...renderRunbookPromptCommands(input.runbookCommands),
    "",
    "If wiki query results or Forge status disagree with this handover, trust the latest wiki/Forge truth and update the handover or lifecycle state before implementation.",
    "",
    "Session summary:",
    input.summary,
    "",
    "Next action:",
    input.nextAction,
    "",
    "Operator prompt:",
    input.operatorPrompt,
  ].join("\n");
}

function renderRunbookSection(runbookCommands: readonly string[] | undefined): readonly string[] {
  if (!runbookCommands || runbookCommands.length === 0) return [];
  return [
    "## Runbook commands",
    "",
    ...runbookCommands.map((command) => `- \`${command}\``),
    "",
  ];
}

function renderRunbookPromptCommands(runbookCommands: readonly string[] | undefined): readonly string[] {
  if (!runbookCommands || runbookCommands.length === 0) return [];
  return ["- Then run the handover runbook commands in order:", ...runbookCommands.map((command) => `  - ${command}`)];
}

function renderRelatedWorkflow(handover: ForgeHandoverRecord): readonly string[] {
  const entries = [
    ...handover.relatedFeatures.map((feature) => `- Feature: ${feature}`),
    ...handover.relatedPrds.map((prd) => `- PRD: ${prd}`),
    ...handover.relatedSlices.map((slice) => `- Slice: ${slice}`),
  ];
  return entries.length > 0 ? entries : ["- None recorded."];
}

function renderWikiQueryCommands(input: Pick<HandoverPromptInput, "project" | "relatedPrds" | "relatedSlices">): readonly string[] {
  const sliceTerms = input.relatedSlices.length > 0 ? input.relatedSlices.join(" ") : "Forge slices active ready in-progress handover";
  const prdTerms = input.relatedPrds.length > 0 ? input.relatedPrds.join(" ") : "Forge PRD requirements latest";
  return [
    `wiki query --bm25 ${quoteShell(`${input.project} latest decisions architecture handover`)}`,
    `wiki query --bm25 ${quoteShell(`${input.project} ${sliceTerms}`)}`,
    `wiki query --bm25 ${quoteShell(`${input.project} ${prdTerms}`)}`,
  ];
}

function renderStatusCommands(input: HandoverPromptInput): readonly string[] {
  if (input.relatedSlices.length === 0) return [];
  return input.relatedSlices.map((slice) => `wiki forge status ${input.project} ${slice} --repo ${quoteShell(input.repo ?? ".")} --json`);
}

function renderStringList(key: string, values: readonly string[]): string {
  if (values.length === 0) return `${key}: []`;
  return [`${key}:`, ...values.map((value) => `  - ${quoteScalar(value)}`)].join("\n");
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function quoteScalar(value: string): string {
  return JSON.stringify(value);
}
