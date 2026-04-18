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
  lifecycle: {
    beforeStarting: string[];
    duringWork: string[];
    beforeCompletion: string[];
  };
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
    lifecycle: {
      beforeStarting: [`\`wiki start-slice ${project} <slice-id> --agent <name> --repo <path>\``],
      duringWork: [`\`wiki checkpoint ${project} --repo <path>\``, `\`wiki lint-repo ${project} --repo <path>\``],
      beforeCompletion: [
        `\`wiki maintain ${project} --repo <path> --base <rev>\``,
        "update impacted wiki pages from code and tests",
        `\`wiki verify-page ${project} <page...> <level>\``,
        `\`wiki verify-slice ${project} <slice-id> --repo <path>\``,
        `\`wiki closeout ${project} --repo <path> --base <rev>\``,
        `\`wiki gate ${project} --repo <path> --base <rev>\``,
        `\`wiki close-slice ${project} <slice-id> --repo <path> --base <rev>\``,
      ],
    },
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
    "## Wiki Protocol",
    "",
    "Before starting slice work:",
    ...source.lifecycle.beforeStarting.map((line) => `- ${line}`),
    "",
    "During work:",
    ...source.lifecycle.duringWork.map((line) => `- ${line}`),
    "",
    "Before completion:",
    ...source.lifecycle.beforeCompletion.map((line) => `- ${line}`),
    "",
    END_MARKER,
  ].join("\n");
}

export function renderPromptProtocolReminders(project: string) {
  const source = buildCanonicalProtocolSource(project, { path: ".", scope: "root" });
  return [
    ...source.workflowLines.slice(0, 3),
    `Start tracked slice work with ${source.lifecycle.beforeStarting[0]}.`,
    `Finish tracked slice work with ${source.lifecycle.beforeCompletion[3]}, ${source.lifecycle.beforeCompletion[4]}, and ${source.lifecycle.beforeCompletion[5]}.`,
  ];
}

export function renderHandoverAlignmentReminder(project: string) {
  return buildCanonicalProtocolSource(project, { path: ".", scope: "root" }).handoverReminder;
}
