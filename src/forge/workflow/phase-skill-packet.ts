export type PhaseSkillPacketPhase = "plan" | "implementation" | "improvement-review";

export type PhaseSkillPacketContext = {
  readonly project?: string;
  readonly featureName?: string;
  readonly sliceId?: string;
};

export type PhaseSkillPacket = {
  readonly kind: "phase-skill-packet";
  readonly phase: PhaseSkillPacketPhase;
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
    `Required skills: ${packet.requiredSkills.map(renderSkillName).join(" -> ")}`,
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
