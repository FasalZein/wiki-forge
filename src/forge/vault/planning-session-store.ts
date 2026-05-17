import matter from "gray-matter";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { VAULT_ROOT } from "../../constants";
import { nowIso, writeNormalizedPage } from "../../cli-shared";
import { forgePlanningSessionPath, forgeProjectDir } from "./forge-paths";
import { absoluteVaultPath, forgeArtifactSlug } from "./forge-artifacts";
import { writePlanningArtifacts } from "./planning-artifact-writer";
import { orderForgeFrontmatter, renderPlanningSessionBody } from "./planning-session-rendering";
import type { PlanningAnswer, PlanningArtifacts, PlanningPrdCandidate, PlanningSession, PlanningSkill } from "./planning-types";

export type { PlanningAnswer, PlanningArtifacts, PlanningPrdCandidate, PlanningSession, PlanningSkill } from "./planning-types";

export type PlanningSessionGate = {
  readonly status: "blocked" | "ready";
  readonly missing: readonly string[];
};

export type RecordPlanningAnswerInput = {
  readonly project: string;
  readonly featureName: string;
  readonly skill: PlanningSkill;
  readonly answerId: string;
  readonly response: string;
  readonly recommendation?: string;
  readonly prdName?: string;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export type MutatePlanningSessionInput = {
  readonly project: string;
  readonly featureName: string;
  readonly prdName?: string;
  readonly sliceTitle?: string;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export type PlanningArtifactsInput = {
  readonly project: string;
  readonly featureName: string;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export async function readPlanningSession(project: string, featureName: string, vaultRoot = VAULT_ROOT): Promise<PlanningSession | null> {
  const path = planningSessionPath(vaultRoot, project, featureName);
  if (!existsSync(path)) return null;
  return parsePlanningSession(await readFile(path, "utf8"));
}

export async function ensurePlanningSession(project: string, featureName: string, now = nowIso(), vaultRoot = VAULT_ROOT): Promise<PlanningSession> {
  const existing = await readPlanningSession(project, featureName, vaultRoot);
  if (existing) return existing;
  const session: PlanningSession = {
    project,
    featureName,
    sessionId: planningSessionId(featureName),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    answers: [],
    prds: [],
  };
  await writePlanningSession(session, vaultRoot);
  return session;
}

export async function recordPlanningAnswer(input: RecordPlanningAnswerInput): Promise<PlanningSession> {
  const vaultRoot = input.vaultRoot ?? VAULT_ROOT;
  const now = input.now ?? nowIso();
  const session = await ensurePlanningSession(input.project, input.featureName, now, vaultRoot);
  const normalizedAnswer: PlanningAnswer = {
    id: input.answerId,
    skill: input.skill,
    response: input.response,
    ...(input.recommendation ? { recommendation: input.recommendation } : {}),
    ...(input.prdName ? { prdName: input.prdName } : {}),
    recordedAt: now,
  };
  const answers = [...session.answers.filter((answer) => answer.id !== input.answerId || answer.prdName !== input.prdName), normalizedAnswer];
  const prds = input.prdName && input.skill === "grill-me"
    ? upsertPrdCandidate(session.prds, input.prdName)
    : session.prds;
  return writePlanningSession({ ...session, status: "draft", answers, prds, updatedAt: now, artifacts: undefined }, vaultRoot);
}

export async function addPlanningPrd(input: MutatePlanningSessionInput): Promise<PlanningSession> {
  if (!input.prdName?.trim()) throw new Error("missing --prd");
  const vaultRoot = input.vaultRoot ?? VAULT_ROOT;
  const now = input.now ?? nowIso();
  const session = await ensurePlanningSession(input.project, input.featureName, now, vaultRoot);
  return writePlanningSession({
    ...session,
    status: "draft",
    prds: upsertPrdCandidate(session.prds, input.prdName),
    updatedAt: now,
    artifacts: undefined,
  }, vaultRoot);
}

export async function addPlanningSlice(input: MutatePlanningSessionInput): Promise<PlanningSession> {
  if (!input.prdName?.trim()) throw new Error("missing --prd");
  if (!input.sliceTitle?.trim()) throw new Error("missing --slice");
  const vaultRoot = input.vaultRoot ?? VAULT_ROOT;
  const now = input.now ?? nowIso();
  const session = await ensurePlanningSession(input.project, input.featureName, now, vaultRoot);
  const prds = upsertSlice(session.prds, input.prdName, input.sliceTitle);
  return writePlanningSession({ ...session, status: "draft", prds, updatedAt: now, artifacts: undefined }, vaultRoot);
}

export async function completePlanningSession(input: MutatePlanningSessionInput): Promise<{ session: PlanningSession; gate: PlanningSessionGate }> {
  const vaultRoot = input.vaultRoot ?? VAULT_ROOT;
  const now = input.now ?? nowIso();
  const session = await ensurePlanningSession(input.project, input.featureName, now, vaultRoot);
  const gate = evaluatePlanningSessionGate(session);
  if (gate.status === "blocked") return { session, gate };
  const completed = await writePlanningSession({ ...session, status: "ready-for-artifacts", updatedAt: now }, vaultRoot);
  return { session: completed, gate };
}

export async function createPlanningArtifacts(input: PlanningArtifactsInput): Promise<{ session: PlanningSession; artifacts: PlanningArtifacts }> {
  const vaultRoot = input.vaultRoot ?? VAULT_ROOT;
  const now = input.now ?? nowIso();
  const session = await ensurePlanningSession(input.project, input.featureName, now, vaultRoot);
  const gate = evaluatePlanningSessionGate(session);
  if (session.status !== "ready-for-artifacts" || gate.status === "blocked") {
    throw new Error(`planning session is not complete: ${gate.missing.join(", ") || "run --complete-session first"}`);
  }
  const artifacts = await writePlanningArtifacts({ vaultRoot, project: input.project, featureName: input.featureName, session, now });
  const updated = await writePlanningSession({ ...session, status: "artifacts-created", artifacts, updatedAt: now }, vaultRoot);
  return { session: updated, artifacts };
}

export function evaluatePlanningSessionGate(session: PlanningSession | null): PlanningSessionGate {
  if (!session) return { status: "blocked", missing: ["plan-answer", "prd-candidate", "slice-breakdown"] };
  const missing: string[] = [];
  const hasUnifiedPlan = session.answers.some((answer) => answer.skill === "plan");
  const hasLegacyPlanInputs = session.answers.some((answer) => answer.skill === "torpathy")
    && session.answers.some((answer) => answer.skill === "grill-with-docs");
  if (!hasUnifiedPlan && !hasLegacyPlanInputs) missing.push("plan-answer");
  if (session.prds.length === 0) missing.push("prd-candidate");
  for (const prd of session.prds) {
    if (prd.slices.length === 0) missing.push(`slice-breakdown:${prd.name}`);
  }
  return missing.length === 0 ? { status: "ready", missing: [] } : { status: "blocked", missing };
}

function parsePlanningSession(raw: string): PlanningSession {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  return {
    project: readRequiredString(data.project, "project"),
    featureName: readRequiredString(data.feature_name, "feature_name"),
    sessionId: readRequiredString(data.session_id, "session_id"),
    status: readSessionStatus(data.status),
    createdAt: readRequiredString(data.created_at, "created_at"),
    updatedAt: readRequiredString(data.updated_at, "updated_at"),
    answers: readAnswers(data.answers),
    prds: readPrds(data.prds),
    ...(isPlanningArtifacts(data.artifacts) ? { artifacts: data.artifacts } : {}),
  };
}

async function writePlanningSession(session: PlanningSession, vaultRoot: string): Promise<PlanningSession> {
  const path = planningSessionPath(vaultRoot, session.project, session.featureName);
  await mkdir(absoluteVaultPath(vaultRoot, `${forgeProjectDir(session.project)}/sessions`), { recursive: true });
  const frontmatter = orderForgeFrontmatter({
    title: `Planning session — ${session.featureName}`,
    type: "planning-session",
    project: session.project,
    feature_name: session.featureName,
    session_id: session.sessionId,
    status: session.status,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    answers: session.answers,
    prds: session.prds,
    ...(session.artifacts ? { artifacts: session.artifacts } : {}),
  });
  writeNormalizedPage(path, renderPlanningSessionBody(session, evaluatePlanningSessionGate(session)), frontmatter);
  return session;
}

function planningSessionPath(vaultRoot: string, project: string, featureName: string): string {
  return absoluteVaultPath(vaultRoot, forgePlanningSessionPath(project, planningSessionId(featureName)));
}

function planningSessionId(featureName: string): string {
  return forgeArtifactSlug(featureName || "unnamed-feature");
}

function upsertPrdCandidate(prds: readonly PlanningPrdCandidate[], prdName: string): readonly PlanningPrdCandidate[] {
  const name = prdName.trim();
  if (prds.some((prd) => prd.name === name)) return prds;
  return [...prds, { name, slices: [] }];
}

function upsertSlice(prds: readonly PlanningPrdCandidate[], prdName: string, sliceTitle: string): readonly PlanningPrdCandidate[] {
  const name = prdName.trim();
  const title = sliceTitle.trim();
  const existing = prds.find((prd) => prd.name === name);
  if (!existing) return [...prds, { name, slices: [title] }];
  return prds.map((prd) => prd.name === name ? { ...prd, slices: prd.slices.includes(title) ? prd.slices : [...prd.slices, title] } : prd);
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new Error(`invalid planning session: missing ${label}`);
}

function readSessionStatus(value: unknown): PlanningSession["status"] {
  if (value === "draft" || value === "ready-for-artifacts" || value === "artifacts-created") return value;
  throw new Error(`invalid planning session status: ${String(value)}`);
}

function readAnswers(value: unknown): readonly PlanningAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => normalizePlanningAnswer(entry));
}

function readPrds(value: unknown): readonly PlanningPrdCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => isPlanningPrdCandidate(entry) ? [entry] : []);
}

function normalizePlanningAnswer(value: unknown): PlanningAnswer[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.response !== "string" || typeof record.recordedAt !== "string") return [];
  if (record.skill !== "plan" && record.skill !== "torpathy" && record.skill !== "grill-with-docs" && record.skill !== "domain-model" && record.skill !== "grill-me") return [];
  return [{
    id: record.id,
    skill: record.skill === "domain-model" ? "grill-with-docs" : record.skill,
    response: record.response,
    ...(typeof record.recommendation === "string" ? { recommendation: record.recommendation } : {}),
    ...(typeof record.prdName === "string" ? { prdName: record.prdName } : {}),
    recordedAt: record.recordedAt,
  }];
}

function isPlanningPrdCandidate(value: unknown): value is PlanningPrdCandidate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && Array.isArray(record.slices) && record.slices.every((slice) => typeof slice === "string");
}

function isPlanningArtifacts(value: unknown): value is PlanningArtifacts {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.featureId === "string" && Array.isArray(record.prds);
}
