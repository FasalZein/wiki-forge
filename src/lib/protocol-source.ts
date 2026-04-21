import { orderFrontmatter } from "../cli-shared";

export type ProtocolScope = {
  path: string;
  scope: string;
};

export type CanonicalProtocolSource = {
  managedBy: "wiki-forge";
  protocolVersion: number;
  project: string;
  scope: ProtocolScope;
  scopeLine: string;
  workflowLines: string[];
  codeQualityIntro: string;
  codeQualityRules: string[];
  codeQualitySummary: string;
  handoverReminder: string;
};

export const PROTOCOL_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
export const START_MARKER = "<!-- wiki-forge:agent-protocol:start -->";
export const END_MARKER = "<!-- wiki-forge:agent-protocol:end -->";
export const PROTOCOL_VERSION = 2;

export function buildCanonicalProtocolSource(project: string, scope: ProtocolScope): CanonicalProtocolSource {
  return {
    managedBy: "wiki-forge",
    protocolVersion: PROTOCOL_VERSION,
    project,
    scope,
    scopeLine: scope.scope === "root" ? "Scope: repo root" : `Scope: ${scope.scope}`,
    workflowLines: [
      "Use `/forge` for non-trivial implementation work.",
      "Use `/wiki` for retrieval, refresh, drift, verification, and closeout review.",
      "If slash-skill aliases are unavailable, run the equivalent `wiki` CLI lifecycle directly.",
      "`wiki protocol sync` only syncs this managed block; it does not enforce behavior or sync skill policy.",
    ],
    codeQualityIntro: "Codex (GPT-5-class reviewer) reviews every change before it merges. Write as if a stricter reviewer is watching:",
    codeQualityRules: [
      "Smaller, more focused diffs. Every changed line should trace to the task.",
      "Honest names. No `foo`, no `handleStuff`, no vague `utils`.",
      "Tight types. No `any`, no unchecked casts, no silent `as unknown as T`.",
      'Real error handling. No bare `catch {}`, no swallowed promises, no `throw new Error("TODO")`.',
      "Tests that describe behavior, not implementation. Delete shallow tests you replace.",
      "Match the surrounding style even when you'd design differently.",
    ],
    codeQualitySummary: "Sloppy code costs a review round-trip. Writing it right the first time is faster than arguing with a reviewer.",
    handoverReminder: "Read **Next Session Priorities** below BEFORE the session-state sections. If this file is truncated, the priorities block is the minimum you need to resume work. Then load `/wiki` and `/forge` skills before continuing.",
  };
}

export function renderProtocolSurface(project: string, scope: ProtocolScope) {
  const source = buildCanonicalProtocolSource(project, scope);
  const data = orderFrontmatter({
    managed_by: source.managedBy,
    protocol_version: source.protocolVersion,
    project,
    scope: scope.scope,
    applies_to: scope.path,
  }, ["managed_by", "protocol_version", "project", "scope", "applies_to"]);
  const frontmatter = [
    "---",
    ...Object.entries(data).flatMap(([key, value]) => Array.isArray(value)
      ? [`${key}:`, ...value.map((item) => `  - ${item}`)]
      : [`${key}: ${String(value)}`]),
    "---",
    "",
  ].join("\n");
  return [frontmatter.trimEnd(), renderManagedProtocolBlock(source)].join("\n");
}

export function renderManagedProtocolBlock(source: CanonicalProtocolSource) {
  return [
    START_MARKER,
    "# Agent Protocol",
    "",
    "> Managed by wiki-forge. Keep local repo-specific notes below the managed block.",
    "> `AGENTS.md` and `CLAUDE.md` carry the same sync-managed protocol block. Do not treat them as separate policy sources.",
    "",
    source.scopeLine,
    "",
    ...source.workflowLines,
    "",
    "## Code Quality",
    "",
    source.codeQualityIntro,
    ...source.codeQualityRules.map((rule) => `- ${rule}`),
    "",
    source.codeQualitySummary,
    "",
    "## Workflow Enforcement",
    "",
    "Load `/forge` for tracked slice work. Load `/wiki` for knowledge-layer work.",
    "The skills define all available commands. This block enforces the contract, not the command surface.",
    "",
    `Agent surface (3 commands): \`wiki forge plan ${source.project} <feature-name>\`, \`wiki forge run ${source.project} [slice-id] --repo <path>\`, \`wiki forge next ${source.project}\``,
    `Session start: \`wiki resume ${source.project} --repo <path> --base <rev>\``,
    "",
    END_MARKER,
  ].join("\n");
}

export function renderPromptProtocolReminders(project: string) {
  const source = buildCanonicalProtocolSource(project, { path: ".", scope: "root" });
  return [
    ...source.workflowLines.slice(0, 3),
    `Start work: \`wiki forge plan ${project} <feature-name>\` — creates feature + PRD + slice + starts it.`,
    `Run pipeline: \`wiki forge run ${project} [slice-id] --repo <path>\` — auto-start + check + verify + close.`,
    `Next slice: \`wiki forge next ${project}\``,
  ];
}

export function renderHandoverAlignmentReminder(project: string) {
  return buildCanonicalProtocolSource(project, { path: ".", scope: "root" }).handoverReminder;
}
