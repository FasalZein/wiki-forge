import { readFileSync } from "node:fs";
import { requireValue } from "../../cli-shared";
import { printJson, printLine } from "../../lib/cli-output";
import { buildPhaseSkillPacket, renderPhaseSkillPacket, type PhaseSkillPacket } from "./phase-skill-packet";
import {
  addPlanningPrd,
  addPlanningSlice,
  completePlanningSession,
  createPlanningArtifacts,
  evaluatePlanningSessionGate,
  readPlanningSession,
  recordPlanningAnswer,
  type PlanningSession,
  type PlanningSessionGate,
  type PlanningSkill,
} from "../vault/planning-session-store";

export async function forgePlanCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const parsed = parsePlanArgs(args);
  if (parsed.action === "answer") {
    requireValue(parsed.skill, "--skill");
    requireValue(parsed.answerId, "--answer");
    requireValue(parsed.response, "--response or --response-file");
    const session = await recordPlanningAnswer({
      project: parsed.project,
      featureName: parsed.featureName,
      skill: parsed.skill,
      answerId: parsed.answerId,
      response: parsed.response,
      ...(parsed.recommendation ? { recommendation: parsed.recommendation } : {}),
      ...(parsed.prdName ? { prdName: parsed.prdName } : {}),
    });
    renderPlanMutation({ status: "recorded", session }, json);
    return;
  }
  if (parsed.action === "add-prd") {
    const session = await addPlanningPrd(parsed);
    renderPlanMutation({ status: "recorded", session }, json);
    return;
  }
  if (parsed.action === "add-slice") {
    const session = await addPlanningSlice(parsed);
    renderPlanMutation({ status: "recorded", session }, json);
    return;
  }
  if (parsed.action === "complete-session") {
    const result = await completePlanningSession(parsed);
    if (result.gate.status === "blocked") {
      renderPlanBlocked(parsed.project, parsed.featureName, result.session, result.gate, json);
      throw Object.assign(new Error(`planning session incomplete: ${result.gate.missing.join(", ")}`), { exitCode: 1 });
    }
    renderPlanMutation({ status: "ready-for-artifacts", session: result.session }, json);
    return;
  }
  if (parsed.action === "create-artifacts") {
    const result = await createPlanningArtifacts(parsed);
    if (json) printJson({ status: "created", session: result.session, artifacts: result.artifacts });
    else printLine(`created ${result.artifacts.featureId} with ${result.artifacts.prds.length} PRD(s)`);
    return;
  }

  const session = await readPlanningSession(parsed.project, parsed.featureName);
  const gate = evaluatePlanningSessionGate(session);
  if (session?.status === "ready-for-artifacts" && gate.status === "ready") {
    renderPlanMutation({ status: "ready-for-artifacts", session }, json);
    return;
  }
  if (session?.status === "artifacts-created") {
    renderPlanMutation({ status: "artifacts-created", session }, json);
    return;
  }
  renderPlanBlocked(parsed.project, parsed.featureName, session, gate, json);
  throw Object.assign(new Error("planning session required before PRD and slice creation"), { exitCode: 1 });
}

type PlanAction = "status" | "answer" | "add-prd" | "add-slice" | "complete-session" | "create-artifacts";

type ParsedPlanArgs = {
  readonly project: string;
  readonly featureName: string;
  readonly action: PlanAction;
  readonly skill?: PlanningSkill;
  readonly answerId?: string;
  readonly response?: string;
  readonly recommendation?: string;
  readonly prdName?: string;
  readonly sliceTitle?: string;
};

const PLAN_VALUE_FLAGS = [
  "--agent",
  "--repo",
  "--feature",
  "--prd-name",
  "--title",
  "--slices",
  "--answer",
  "--plan-answer",
  "--plan-answer-file",
  "--response",
  "--response-file",
  "--skill",
  "--recommendation",
  "--prd",
  "--slice",
  "--torpathy-answer",
  "--torpathy-answer-file",
  "--grill-with-docs-answer",
  "--grill-with-docs-answer-file",
  "--domain-model-answer",
  "--domain-model-answer-file",
  "--prd-grill-answer",
  "--prd-grill-answer-file",
] as const;

const PLAN_BOOLEAN_FLAGS = ["--json", "--create-artifacts", "--complete-session"] as const;

const PLAN_KNOWN_FLAGS = new Set<string>([...PLAN_VALUE_FLAGS, ...PLAN_BOOLEAN_FLAGS]);

type PlanningSessionRequiredPacket = {
  readonly status: "blocked";
  readonly project: string;
  readonly featureName: string;
  readonly gate: "planning-session-required";
  readonly canCreatePrd: false;
  readonly canCreateSlices: false;
  readonly requiredSequence: readonly ["plan", "prd-candidate", "slice-breakdown"];
  readonly requiredSkills: readonly ["forge", "grill-with-docs", "write-a-prd", "prd-to-slices"];
  readonly supportsMultiplePrds: true;
  readonly phasePacket: PhaseSkillPacket;
  readonly missing: readonly string[];
  readonly session: PlanningSession | null;
  readonly nextQuestion: {
    readonly id: "plan-scope-boundary";
    readonly skill: "plan";
    readonly question: string;
    readonly recommendation: string;
  };
  readonly recovery: readonly {
    readonly command: string;
    readonly description: string;
  }[];
};

function parsePlanArgs(args: readonly string[]): ParsedPlanArgs {
  validateKnownPlanFlags(args);
  const positional = readPositionalArgs(args, PLAN_VALUE_FLAGS);
  const project = positional[0];
  requireValue(project, "project");
  const featureName = positional.slice(1).join(" ").trim() || readFlagValue(args, "--feature") || readFlagValue(args, "--title") || "unnamed feature";
  if (args.includes("--create-artifacts")) return { project, featureName, action: "create-artifacts" };
  if (args.includes("--complete-session")) return { project, featureName, action: "complete-session" };
  const convenienceAnswer = readConvenienceAnswer(args);
  if (convenienceAnswer) {
    return {
      project,
      featureName,
      action: "answer",
      answerId: convenienceAnswer.answerId,
      response: convenienceAnswer.response,
      skill: convenienceAnswer.skill,
      recommendation: readFlagValue(args, "--recommendation"),
      prdName: readFlagValue(args, "--prd"),
    };
  }
  const answerId = readFlagValue(args, "--answer");
  if (answerId) {
    const response = readResponseValue(args);
    requireValue(response, "--response or --response-file");
    return {
      project,
      featureName,
      action: "answer",
      answerId,
      response,
      skill: parsePlanningSkill(readFlagValue(args, "--skill") ?? "plan"),
      recommendation: readFlagValue(args, "--recommendation"),
      prdName: readFlagValue(args, "--prd"),
    };
  }
  const sliceTitle = readFlagValue(args, "--slice");
  if (sliceTitle) return { project, featureName, action: "add-slice", prdName: readFlagValue(args, "--prd"), sliceTitle };
  const prdName = readFlagValue(args, "--prd");
  if (prdName) return { project, featureName, action: "add-prd", prdName };
  return { project, featureName, action: "status" };
}

function parsePlanningSkill(value: string): PlanningSkill {
  if (value === "plan" || value === "torpathy" || value === "grill-with-docs" || value === "grill-me") return value;
  if (value === "domain-model") return "grill-with-docs";
  throw new Error(`invalid planning skill: ${value}`);
}

function validateKnownPlanFlags(args: readonly string[]): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    if (PLAN_KNOWN_FLAGS.has(arg)) continue;
    throw new Error(`unknown forge plan option: ${arg}`);
  }
}

type ConvenienceAnswer = {
  readonly answerId: string;
  readonly skill: PlanningSkill;
  readonly response: string;
};

function readConvenienceAnswer(args: readonly string[]): ConvenienceAnswer | null {
  const plan = readFlagOrFile(args, "--plan-answer", "--plan-answer-file");
  if (plan !== undefined) return { answerId: "plan", skill: "plan", response: plan };

  const torpathy = readFlagOrFile(args, "--torpathy-answer", "--torpathy-answer-file");
  if (torpathy !== undefined) return { answerId: "torpathy-boundary", skill: "torpathy", response: torpathy };

  const grillWithDocs = readFlagOrFile(args, "--grill-with-docs-answer", "--grill-with-docs-answer-file")
    ?? readFlagOrFile(args, "--domain-model-answer", "--domain-model-answer-file");
  if (grillWithDocs !== undefined) return { answerId: "context-and-decisions", skill: "grill-with-docs", response: grillWithDocs };

  const prdGrill = readFlagOrFile(args, "--prd-grill-answer", "--prd-grill-answer-file");
  if (prdGrill !== undefined) return { answerId: "prd-grill", skill: "grill-me", response: prdGrill };

  return null;
}

function readResponseValue(args: readonly string[]): string | undefined {
  return readFlagOrFile(args, "--response", "--response-file");
}

function readFlagOrFile(args: readonly string[], valueFlag: string, fileFlag: string): string | undefined {
  const inline = readFlagValue(args, valueFlag);
  const filePath = readFlagValue(args, fileFlag);
  if (inline !== undefined && filePath !== undefined) {
    throw new Error(`use either ${valueFlag} or ${fileFlag}, not both`);
  }
  if (filePath !== undefined) return readFileSync(filePath, "utf8");
  return inline;
}

function buildPlanningSessionRequiredPacket(project: string, featureName: string, session: PlanningSession | null, gate: PlanningSessionGate): PlanningSessionRequiredPacket {
  return {
    status: "blocked",
    project,
    featureName,
    gate: "planning-session-required",
    canCreatePrd: false,
    canCreateSlices: false,
    requiredSequence: ["plan", "prd-candidate", "slice-breakdown"],
    requiredSkills: ["forge", "grill-with-docs", "write-a-prd", "prd-to-slices"],
    supportsMultiplePrds: true,
    phasePacket: buildPhaseSkillPacket("plan", { project, featureName }),
    missing: gate.missing,
    session,
    nextQuestion: {
      id: "plan-scope-boundary",
      skill: "plan",
      question: "What precise user-visible outcome should the first PRD under this feature deliver, and what is explicitly out of scope?",
      recommendation: "Answer once with the user-visible outcome, non-goals, context/decisions, PRD acceptance criteria, and initial slice breakdown; Forge will fan that plan into wiki/Forge artifacts.",
    },
    recovery: [
      {
        command: `wiki forge plan ${project} ${JSON.stringify(featureName)} --plan-answer-file <path>`,
        description: "Record one plan packet covering outcome, non-goals, context/decisions, PRD criteria, and slice breakdown.",
      },
      {
        command: `wiki forge plan ${project} ${JSON.stringify(featureName)} --prd <name> --slice <title>`,
        description: "Add PRD and slice candidates from the same plan packet; repeat --slice for thin tracer bullets.",
      },
      {
        command: `wiki forge plan ${project} ${JSON.stringify(featureName)} --complete-session && wiki forge plan ${project} ${JSON.stringify(featureName)} --create-artifacts`,
        description: "Complete and create artifacts after the one Plan packet has PRD and slice candidates.",
      },
    ],
  };
}

function renderPlanBlocked(project: string, featureName: string, session: PlanningSession | null, gate: PlanningSessionGate, json: boolean): void {
  const packet = buildPlanningSessionRequiredPacket(project, featureName, session, gate);
  if (json) printJson(packet);
  else renderPlanningSessionRequiredPacket(packet);
}

function renderPlanningSessionRequiredPacket(packet: PlanningSessionRequiredPacket): void {
  printLine(`forge plan for ${packet.project}: blocked`);
  printLine("gate: planning-session-required");
  printLine(`feature: ${packet.featureName}`);
  printLine(`missing: ${packet.missing.join(", ") || "none"}`);
  printLine(`next question: ${packet.nextQuestion.question}`);
  printLine(`recommendation: ${packet.nextQuestion.recommendation}`);
  printLine(`required sequence: ${packet.requiredSequence.join(" -> ")}`);
  printLine("");
  printLine(renderPhaseSkillPacket(packet.phasePacket));
}

function renderPlanMutation(payload: { readonly status: "recorded" | "ready-for-artifacts" | "artifacts-created"; readonly session: PlanningSession }, json: boolean): void {
  if (json) printJson(payload);
  else printLine(`planning session ${payload.status}: ${payload.session.featureName}`);
}

function readPositionalArgs(args: readonly string[], valueFlags: readonly string[]): readonly string[] {
  const valueFlagSet = new Set(valueFlags);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (valueFlagSet.has(arg)) index += 1;
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
