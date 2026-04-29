import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { renderForgeNextJson, renderForgeNextText } from "../../forge/workflow/render-next";
import { loadV1ProjectProjection, loadV1SliceStatus } from "../vault/load-project";
import { amendV1Slice, checkV1SliceClose, closeV1Slice, releaseV1Slice, startV1Slice } from "../vault/slice-store";
import { addPlanningPrd, addPlanningSlice, completePlanningSession, createPlanningArtifacts, evaluatePlanningSessionGate, readPlanningSession, recordPlanningAnswer, type PlanningSession, type PlanningSessionGate, type PlanningSkill } from "../vault/planning-session-store";
import { recordV1ReviewEvidence, recordV1TddEvidence, recordV1VerificationEvidence } from "../vault/evidence-store";
export { v1ExportPrompt, v1Handover, v1Log, v1Note, v1Resume } from "./session-commands";

export async function v1ForgeNext(args: string[]): Promise<void> {
  await renderV1ForgeProjection(args);
}

export async function v1ForgeStatus(args: string[]): Promise<void> {
  await renderV1ForgeProjection(args);
}

export async function v1ForgeStart(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const agent = readFlagValue(args, "--agent") ?? "agent";
  const result = await startV1Slice({ project, sliceId, agent });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `started ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function v1ForgeRelease(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const result = await releaseV1Slice({ project, sliceId });
  if (json) printJson(result);
  else printLine(`released ${sliceId}`);
}

export async function v1ForgePlan(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const parsed = parsePlanArgs(args);
  if (parsed.action === "answer") {
    requireValue(parsed.skill, "--skill");
    requireValue(parsed.answerId, "--answer");
    requireValue(parsed.response, "--response");
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

export async function v1ForgeAmend(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const options = parseAmendArgs(args);
  const result = await amendV1Slice(options);
  if (json) printJson(result);
  else printLine(`created amendment ${result.amendmentSliceId} for ${result.closedSliceId}`);
}

export async function v1ForgeCheck(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const closedBy = readFlagValue(args, "--closed-by") ?? readFlagValue(args, "--agent") ?? "agent";
  const result = await checkV1SliceClose({ project, sliceId, closedBy });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `check passed ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function v1ForgeClose(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const closedBy = readFlagValue(args, "--closed-by") ?? readFlagValue(args, "--agent") ?? "agent";
  const result = await closeV1Slice({ project, sliceId, closedBy });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `closed ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function v1ForgeRun(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--agent", "--closed-by"]);
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  const agent = readFlagValue(args, "--agent") ?? readFlagValue(args, "--closed-by") ?? "agent";
  if (sliceId) {
    await v1ForgeClose(args);
    return;
  }

  const projection = await loadV1ProjectProjection(project);
  if (projection.status === "active") {
    const result = await closeV1Slice({ project, sliceId: projection.activeSliceId, closedBy: agent });
    if (json) printJson(result);
    else printLine(result.status === "accepted" ? `closed ${projection.activeSliceId}` : `rejected ${result.rejection.code}`);
    if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
    return;
  }
  if (projection.status === "ready") {
    const result = await startV1Slice({ project, sliceId: projection.nextSliceId, agent });
    if (json) printJson(result);
    else printLine(result.status === "accepted" ? `started ${projection.nextSliceId}` : `rejected ${result.rejection.code}`);
    if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
    return;
  }
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
  if (projection.status === "conflict" || projection.status === "needs-repair") throw Object.assign(new Error(`cannot run ${project}: ${projection.status}`), { exitCode: 1 });
}

export async function v1ForgeEvidence(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  const kind = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  requireValue(kind, "evidence kind");
  const command = readFlagValue(args, "--command");
  requireValue(command, "--command");
  const result = parseEvidenceResult(readFlagValue(args, "--result") ?? "passed");
  const record = kind === "tdd"
    ? await recordV1TddEvidence({ project, sliceId, command, result })
    : await recordV1VerificationEvidence({
      project,
      sliceId,
      command,
      result,
      verificationType: parseVerificationType(readFlagValue(args, "--verification-type") ?? "targeted"),
    });
  if (json) printJson(record);
  else printLine(`recorded ${record.kind} evidence for ${sliceId}`);
}

export async function v1ForgeReview(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const subcommand = positional[0];
  if (subcommand !== "record") throw new Error(`unknown v1 forge review subcommand: ${subcommand ?? ""}`);
  const project = positional[1];
  const sliceId = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const reviewer = readFlagValue(args, "--reviewer");
  requireValue(reviewer, "--reviewer");
  const record = await recordV1ReviewEvidence({
    project,
    sliceId,
    reviewer,
    verdict: parseReviewVerdict(readFlagValue(args, "--verdict") ?? "approved"),
  });
  if (json) printJson(record);
  else printLine(`recorded review evidence for ${sliceId}`);
}

function parseEvidenceResult(value: string): "passed" | "failed" {
  if (value === "passed" || value === "failed") return value;
  throw new Error(`invalid evidence result: ${value}`);
}

function parseVerificationType(value: string): "targeted" | "full-suite" {
  if (value === "targeted" || value === "full-suite") return value;
  throw new Error(`invalid verification type: ${value}`);
}

function parseReviewVerdict(value: string): "approved" | "needs-changes" | "approved-with-followups" {
  const normalized = value.replaceAll("_", "-");
  if (normalized === "approved" || normalized === "needs-changes" || normalized === "approved-with-followups") return normalized;
  throw new Error(`invalid review verdict: ${value}`);
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

type PlanningSessionRequiredPacket = {
  readonly status: "blocked";
  readonly project: string;
  readonly featureName: string;
  readonly gate: "planning-session-required";
  readonly canCreatePrd: false;
  readonly canCreateSlices: false;
  readonly requiredSequence: readonly ["torpathy", "domain-model", "grill-prd", "write-prd", "prd-to-slices"];
  readonly requiredSkills: readonly ["torpathy", "domain-model", "grill-me", "write-a-prd", "prd-to-slices"];
  readonly supportsMultiplePrds: true;
  readonly missing: readonly string[];
  readonly session: PlanningSession | null;
  readonly nextQuestion: {
    readonly id: "plan-scope-boundary";
    readonly skill: "domain-model";
    readonly question: string;
    readonly recommendation: string;
  };
  readonly recovery: readonly {
    readonly command: string;
    readonly description: string;
  }[];
};

function parsePlanArgs(args: readonly string[]): ParsedPlanArgs {
  const positional = readPositionalArgs(args, ["--agent", "--repo", "--feature", "--prd-name", "--title", "--slices", "--answer", "--response", "--skill", "--recommendation", "--prd", "--slice"]);
  const project = positional[0];
  requireValue(project, "project");
  const featureName = positional.slice(1).join(" ").trim() || readFlagValue(args, "--feature") || readFlagValue(args, "--title") || "unnamed feature";
  if (args.includes("--create-artifacts")) return { project, featureName, action: "create-artifacts" };
  if (args.includes("--complete-session")) return { project, featureName, action: "complete-session" };
  const answerId = readFlagValue(args, "--answer");
  if (answerId) {
    const response = readFlagValue(args, "--response");
    requireValue(response, "--response");
    return {
      project,
      featureName,
      action: "answer",
      answerId,
      response,
      skill: parsePlanningSkill(readFlagValue(args, "--skill") ?? "domain-model"),
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
  if (value === "torpathy" || value === "domain-model" || value === "grill-me") return value;
  throw new Error(`invalid planning skill: ${value}`);
}

function buildPlanningSessionRequiredPacket(project: string, featureName: string, session: PlanningSession | null, gate: PlanningSessionGate): PlanningSessionRequiredPacket {
  return {
    status: "blocked",
    project,
    featureName,
    gate: "planning-session-required",
    canCreatePrd: false,
    canCreateSlices: false,
    requiredSequence: ["torpathy", "domain-model", "grill-prd", "write-prd", "prd-to-slices"],
    requiredSkills: ["torpathy", "domain-model", "grill-me", "write-a-prd", "prd-to-slices"],
    supportsMultiplePrds: true,
    missing: gate.missing,
    session,
    nextQuestion: {
      id: "plan-scope-boundary",
      skill: "domain-model",
      question: "What precise user-visible outcome should the first PRD under this feature deliver, and what is explicitly out of scope?",
      recommendation: "Define one narrow PRD outcome first, record the terms/decisions in the domain model, then grill that PRD before creating slices.",
    },
    recovery: [
      {
        command: `Start a Torpathy + domain-model planning session for ${project}`,
        description: "Resolve the feature boundary, terminology, and ownership before PRD creation.",
      },
      {
        command: "Run one grill session per PRD candidate",
        description: "A feature may contain multiple PRDs, but each PRD needs its own challenged scope and acceptance criteria.",
      },
      {
        command: "Create PRD(s), then decompose approved PRD(s) into slices",
        description: "Do not create implementation slices until the relevant PRD session is complete.",
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
}

function renderPlanMutation(payload: { readonly status: "recorded" | "ready-for-artifacts" | "artifacts-created"; readonly session: PlanningSession }, json: boolean): void {
  if (json) printJson(payload);
  else printLine(`planning session ${payload.status}: ${payload.session.featureName}`);
}

function parseAmendArgs(args: readonly string[]) {
  const positional: string[] = [];
  const sourcePaths: string[] = [];
  let reason: string | undefined;
  let title: string | undefined;
  let agent: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--reason":
        reason = args[index + 1];
        index += 1;
        break;
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--source":
        while (args[index + 1] && !args[index + 1]?.startsWith("--")) {
          sourcePaths.push(String(args[index + 1]).replaceAll("\\", "/"));
          index += 1;
        }
        break;
      case "--json":
      case "--start":
      case "--legacy":
        break;
      default:
        if (!arg.startsWith("--")) positional.push(arg);
        break;
    }
  }
  const project = positional[0];
  const closedSliceId = positional[1];
  requireValue(project, "project");
  requireValue(closedSliceId, "closed-slice-id");
  requireValue(reason, "--reason");
  return {
    project,
    closedSliceId,
    reason,
    ...(title ? { title } : {}),
    ...(agent ? { agent } : {}),
    sourcePaths,
    start: args.includes("--start"),
  };
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

async function renderV1ForgeProjection(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--repo", "--base", "--agent", "--closed-by"]);
  const project = positional[0];
  requireValue(project, "project");
  const sliceId = positional[1];
  if (sliceId) {
    const status = await loadV1SliceStatus(project, sliceId);
    if (json) printJson(status);
    else printLine(renderV1SliceStatusText(status));
    return;
  }
  const projection = await loadV1ProjectProjection(project);
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
}

function renderV1SliceStatusText(status: Awaited<ReturnType<typeof loadV1SliceStatus>>): string {
  if (status.status === "missing") return `${status.project}/${status.sliceId}: missing canonical slice hub`;
  if (status.status === "needs-repair") return `${status.project}/${status.sliceId}: repair canonical slice hub`;
  return [
    `${status.project}/${status.sliceId}: ${status.status}`,
    `lifecycle: ${status.lifecycleStatus}`,
    `next: ${status.nextAction}`,
  ].join("\n");
}
