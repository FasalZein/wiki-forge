export type PhaseSkillPacketPhase = "plan" | "implementation" | "improvement-review";

export type WorkflowProfile = "feature" | "bugfix" | "research-wiki-only" | "standalone-engineering";

export type ArtifactOwner = "forge" | "wiki" | "agent-input" | "external";

export type PhaseSubagentPolicy = {
  readonly allowed: boolean;
  readonly mode: "read-only" | "review-evidence-only" | "implementation-grants-only" | "not-applicable";
  readonly guidance: string;
};

export type PhaseSkillPacketContext = {
  readonly project?: string;
  readonly featureName?: string;
  readonly sliceId?: string;
};

export type PhaseSkillPacket = {
  readonly kind: "phase-skill-packet";
  readonly phase: PhaseSkillPacketPhase;
  readonly workflowProfile: WorkflowProfile;
  readonly artifactOwner: ArtifactOwner;
  readonly allowedWrites: readonly string[];
  readonly forbiddenWrites: readonly string[];
  readonly subagentPolicy: PhaseSubagentPolicy;
  readonly requiredSkills: readonly string[];
  readonly requiredOutputs: readonly string[];
  readonly forbiddenFallbacks: readonly string[];
  readonly nextCommands: readonly string[];
  readonly contextDiscipline: string;
};

export function buildPhaseSkillPacket(phase: PhaseSkillPacketPhase, context: PhaseSkillPacketContext = {}): PhaseSkillPacket {
  switch (phase) {
    case "plan":
      return buildPlanPacket(context);
    case "implementation":
      return buildImplementationPacket(context);
    case "improvement-review":
      return buildImprovementReviewPacket(context);
  }
}

export function renderPhaseSkillPacket(packet: PhaseSkillPacket): string {
  return [
    `Phase packet: ${packet.phase}`,
    `Workflow profile: ${packet.workflowProfile}`,
    `Artifact owner: ${packet.artifactOwner}`,
    `Required skills: ${packet.requiredSkills.map(renderSkillName).join(" -> ")}`,
    "Allowed writes:",
    ...packet.allowedWrites.map((write) => `- ${write}`),
    "Forbidden writes:",
    ...packet.forbiddenWrites.map((write) => `- ${write}`),
    `Subagent policy: ${packet.subagentPolicy.allowed ? packet.subagentPolicy.mode : "disabled"} — ${packet.subagentPolicy.guidance}`,
    "Required outputs:",
    ...packet.requiredOutputs.map((output) => `- ${output}`),
    "Forbidden fallbacks:",
    ...packet.forbiddenFallbacks.map((fallback) => `- ${fallback}`),
    "Next commands:",
    ...packet.nextCommands.map((command) => `- ${command}`),
    `Context discipline: ${packet.contextDiscipline}`,
  ].join("\n");
}

function buildPlanPacket(context: PhaseSkillPacketContext): PhaseSkillPacket {
  const project = context.project ?? "<project>";
  const featureName = context.featureName ?? "<feature-name>";
  return {
    kind: "phase-skill-packet",
    phase: "plan",
    workflowProfile: "feature",
    artifactOwner: "forge",
    allowedWrites: [
      "agent-authored plan-answer input files",
      "Forge-created feature, PRD, slice, and planning-session artifacts via wiki forge plan",
      "Wiki context/ADR updates via wiki forge grill record",
    ],
    forbiddenWrites: [
      "direct PRD markdown writes",
      "direct slice markdown writes",
      "repo-local project memory markdown",
    ],
    subagentPolicy: {
      allowed: true,
      mode: "read-only",
      guidance: "planning/scout subagents may gather context; Forge artifact creation remains parent/kernel-owned",
    },
    requiredSkills: ["grill-with-docs", "forge"],
    requiredOutputs: [
      "resolved context and decisions",
      "feature",
      "PRD",
      "slices",
    ],
    forbiddenFallbacks: [
      "do not create PRDs or slices without resolved planning context",
      "do not skip PRD or slice creation unless Forge reports an audited skip reason",
    ],
    nextCommands: [
      `wiki forge plan ${project} ${quoteFeatureName(featureName)} --plan-answer-file <path>`,
      `wiki forge plan ${project} ${quoteFeatureName(featureName)} --complete-session`,
      `wiki forge plan ${project} ${quoteFeatureName(featureName)} --create-artifacts`,
    ],
    contextDiscipline: "Read only the documents needed to resolve terms, boundaries, decisions, PRD criteria, and slice breakdown.",
  };
}

function buildImplementationPacket(context: PhaseSkillPacketContext): PhaseSkillPacket {
  const project = context.project ?? "<project>";
  const sliceId = context.sliceId ?? "<slice-id>";
  return {
    kind: "phase-skill-packet",
    phase: "implementation",
    workflowProfile: "feature",
    artifactOwner: "forge",
    allowedWrites: [
      "source and test files for the active slice",
      "TDD evidence through wiki forge tdd cycle",
      "verification evidence through wiki forge evidence",
      "review session/evidence through wiki forge review start/record",
    ],
    forbiddenWrites: [
      "mutating inactive slices",
      "direct Forge evidence frontmatter edits",
      "direct close-state edits",
      "ad-hoc lifecycle markdown outside Forge commands",
    ],
    subagentPolicy: {
      allowed: true,
      mode: "review-evidence-only",
      guidance: "review subagents may inspect implementation and produce review findings; parent records lifecycle evidence",
    },
    requiredSkills: ["forge", "tdd"],
    requiredOutputs: [
      "red TDD evidence",
      "green TDD evidence",
      "targeted verification",
      "review evidence",
    ],
    forbiddenFallbacks: [
      "do not implement without recording red and green TDD evidence",
      "do not close from passing tests alone without targeted verification and review evidence",
    ],
    nextCommands: [
      `wiki forge tdd cycle ${project} ${sliceId} --test <path> --red-command "<failing test command>" --green-command "<passing test command>"`,
      `wiki forge evidence ${project} ${sliceId} verify --command "<targeted verification command>"`,
      `wiki forge review start ${project} ${sliceId} --reviewer <reviewer> --mode subagent`,
      `wiki forge review record ${project} ${sliceId} --verdict approved --reviewer <reviewer>`,
    ],
    contextDiscipline: "Read the active slice, touched source files, and the narrow tests needed for the current red/green loop.",
  };
}

function buildImprovementReviewPacket(context: PhaseSkillPacketContext): PhaseSkillPacket {
  const project = context.project ?? "<project>";
  return {
    kind: "phase-skill-packet",
    phase: "improvement-review",
    workflowProfile: "standalone-engineering",
    artifactOwner: "wiki",
    allowedWrites: [
      "Wiki architecture review notes",
      "desloppify findings summaries",
      "Forge plan-answer inputs for accepted follow-up work",
    ],
    forbiddenWrites: [
      "untracked broad cleanup edits",
      "direct feature/PRD/slice artifacts outside wiki forge plan",
      "scanner-driven source edits without accepted Forge follow-up",
    ],
    subagentPolicy: {
      allowed: true,
      mode: "read-only",
      guidance: "architecture and scanner subagents may report findings; implementation requires accepted Forge-tracked follow-up work",
    },
    requiredSkills: ["improve-codebase-architecture", "desloppify", "forge"],
    requiredOutputs: [
      "architecture findings",
      "desloppify findings",
      "accepted Forge-tracked follow-up work",
    ],
    forbiddenFallbacks: [
      "do not apply broad cleanup outside Forge-tracked slices",
      "do not turn scanner output into implementation without accepted follow-up work",
    ],
    nextCommands: [
      `wiki forge plan ${project} "<accepted-improvement>" --plan-answer-file <path>`,
    ],
    contextDiscipline: "Prefer repository-level findings summaries; open implementation files only for accepted follow-up candidates.",
  };
}

function renderSkillName(skill: string): string {
  return skill.startsWith("/") ? skill : `/${skill}`;
}

function quoteFeatureName(featureName: string): string {
  if (featureName.startsWith("<") && featureName.endsWith(">")) return featureName;
  return JSON.stringify(featureName);
}
