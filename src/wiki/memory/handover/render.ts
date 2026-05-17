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
  readonly handoverPath?: string;
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
    `operator_intent: ${quoteScalar(handover.copyPastePrompt)}`,
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
    "## Resume contract",
    "",
    "Do not reconstruct the prior conversation. Treat this record as a routing packet, then use current Forge truth and explicitly related artifacts as the source of truth.",
    "",
    "## Minimal refresh",
    "",
    "Run targeted freshness and Forge status checks before changing files. Use broad wiki queries only if this handover is stale or a referenced artifact is missing.",
    "",
    "```bash",
    ...renderMinimalRefreshCommands({
      project: handover.project,
      relatedSlices: handover.relatedSlices,
      base: handover.baseRevision,
    }),
    "```",
    "",
    "## Next action",
    "",
    handover.nextAction,
    "",
    ...renderRunbookSection(handover.runbookCommands),
  ].join("\n");
}

export function renderStructuredHandoverPrompt(input: HandoverPromptInput): string {
  return [
    `Continue ${input.project} from the Forge handover${input.handoverPath ? ` at ${input.handoverPath}` : ""}.`,
    "",
    "Do not reconstruct the prior conversation. Read the handover record, current Forge truth, and explicitly referenced artifacts only. Run broad wiki queries only if the handover is stale or references are missing.",
    "",
    "Minimal refresh:",
    `- wiki checkpoint ${input.project} --repo ${quoteShell(input.repo ?? ".")} --base ${quoteShell(input.base ?? "HEAD")}`,
    `- wiki forge next ${input.project} --repo ${quoteShell(input.repo ?? ".")}`,
    ...renderStatusCommands(input).map((command) => `- ${command}`),
    ...renderRunbookPromptCommands(input.runbookCommands),
    "",
    "Next action:",
    input.nextAction,
    "",
    "Operator intent:",
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

function renderMinimalRefreshCommands(input: Pick<HandoverPromptInput, "project" | "relatedSlices"> & { readonly base?: string }): readonly string[] {
  return [
    `wiki checkpoint ${input.project} --repo . --base ${quoteShell(input.base ?? "HEAD")}`,
    `wiki forge next ${input.project} --repo .`,
    ...input.relatedSlices.map((slice) => `wiki forge status ${input.project} ${slice} --repo . --json`),
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
