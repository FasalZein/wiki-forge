import matter from "gray-matter";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, writeNormalizedPage } from "../../cli-shared";
import { forgeFeaturePath, forgePrdPath, forgeProjectDir, forgeSliceDir, forgeSlicePath, forgeSlicePlanPath, forgeSliceTestPlanPath, forgePlanningSessionPath } from "./forge-paths";
import { renderFeatureBody, renderPrdBody, renderSliceHubBody, renderSlicePlanBody, renderSliceTestPlanBody } from "./planning-artifact-templates";
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
  const featureId = await nextNumericId(vaultRoot, input.project, "feature");
  const featureSlug = slugify(input.featureName);
  const featurePath = absoluteVaultPath(vaultRoot, forgeFeaturePath(input.project, featureId, featureSlug));
  await mkdir(absoluteVaultPath(vaultRoot, `${forgeProjectDir(input.project)}/features`), { recursive: true });
  writeNormalizedPage(featurePath, renderFeatureBody(session), orderForgeFrontmatter({
    title: input.featureName,
    type: "forge-feature",
    project: input.project,
    feature_id: featureId,
    status: "draft",
    created_at: now,
    updated: now,
    planning_session: session.sessionId,
  }));

  const prdArtifacts: {
    prdId: string;
    name: string;
    slices: string[];
  }[] = [];
  let prdCounter = await currentMaxNumber(vaultRoot, input.project, "prd");
  let sliceCounter = await currentMaxNumber(vaultRoot, input.project, "slice");
  await mkdir(absoluteVaultPath(vaultRoot, `${forgeProjectDir(input.project)}/prds`), { recursive: true });
  for (const candidate of session.prds) {
    prdCounter += 1;
    const prdId = `PRD-${String(prdCounter).padStart(3, "0")}`;
    const prdPath = absoluteVaultPath(vaultRoot, forgePrdPath(input.project, prdId, slugify(candidate.name)));
    writeNormalizedPage(prdPath, renderPrdBody(session, candidate), orderForgeFrontmatter({
      title: candidate.name,
      type: "forge-prd",
      project: input.project,
      prd_id: prdId,
      parent_feature: featureId,
      status: "draft",
      created_at: now,
      updated: now,
      planning_session: session.sessionId,
    }));

    const sliceIds: string[] = [];
    for (const sliceTitle of candidate.slices) {
      sliceCounter += 1;
      const sliceId = `${input.project.replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").toUpperCase()}-${String(sliceCounter).padStart(3, "0")}`;
      await writePlannedSlice({ vaultRoot, project: input.project, featureId, prdId, sliceId, title: sliceTitle, now, sessionId: session.sessionId });
      sliceIds.push(sliceId);
    }
    prdArtifacts.push({ prdId, name: candidate.name, slices: sliceIds });
  }
  const artifacts: PlanningArtifacts = { featureId, prds: prdArtifacts };
  const updated = await writePlanningSession({ ...session, status: "artifacts-created", artifacts, updatedAt: now }, vaultRoot);
  return { session: updated, artifacts };
}

export function evaluatePlanningSessionGate(session: PlanningSession | null): PlanningSessionGate {
  if (!session) return { status: "blocked", missing: ["torpathy-answer", "domain-model-answer", "prd-candidate", "prd-grill", "slice-breakdown"] };
  const missing: string[] = [];
  if (!session.answers.some((answer) => answer.skill === "torpathy")) missing.push("torpathy-answer");
  if (!session.answers.some((answer) => answer.skill === "domain-model")) missing.push("domain-model-answer");
  if (session.prds.length === 0) missing.push("prd-candidate");
  for (const prd of session.prds) {
    if (!session.answers.some((answer) => answer.skill === "grill-me" && answer.prdName === prd.name)) missing.push(`prd-grill:${prd.name}`);
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
  writeNormalizedPage(path, planningSessionBody(session), frontmatter);
  return session;
}

function planningSessionBody(session: PlanningSession): string {
  const gate = evaluatePlanningSessionGate(session);
  return [
    `# Planning Session — ${session.featureName}`,
    "",
    "> [!summary]",
    "> Forge Forge planning-session state. This is lifecycle input, not a legacy backlog projection.",
    "",
    "## Gate",
    "",
    `- Status: ${session.status}`,
    `- Missing: ${gate.missing.length ? gate.missing.join(", ") : "none"}`,
    "",
    "## Required Sequence",
    "",
    "1. Torpathy framing",
    "2. Domain-model questions and decision capture",
    "3. One grill session per PRD candidate",
    "4. PRD creation",
    "5. PRD-to-slices",
    "",
    "## PRD Candidates",
    "",
    ...session.prds.flatMap((prd) => [`- ${prd.name}`, ...prd.slices.map((slice) => `  - Slice: ${slice}`)]),
  ].join("\n");
}

type PlannedSliceInput = {
  readonly vaultRoot: string;
  readonly project: string;
  readonly featureId: string;
  readonly prdId: string;
  readonly sliceId: string;
  readonly title: string;
  readonly now: string;
  readonly sessionId: string;
};

async function writePlannedSlice(input: PlannedSliceInput): Promise<void> {
  const dir = absoluteVaultPath(input.vaultRoot, forgeSliceDir(input.project, input.sliceId));
  await mkdir(dir, { recursive: true });
  const baseFrontmatter = {
    title: `${input.sliceId} ${input.title}`,
    type: "forge-slice",
    project: input.project,
    task_id: input.sliceId,
    parent_prd: input.prdId,
    parent_feature: input.featureId,
    planning_session: input.sessionId,
    created_at: input.now,
    updated: input.now,
    status: "draft",
  };
  writeNormalizedPage(absoluteVaultPath(input.vaultRoot, forgeSlicePath(input.project, input.sliceId)), renderSliceHubBody(input), orderForgeFrontmatter({ ...baseFrontmatter, review_policy: { required_approvals: 1 } }));
  writeNormalizedPage(absoluteVaultPath(input.vaultRoot, forgeSlicePlanPath(input.project, input.sliceId)), renderSlicePlanBody(input), orderForgeFrontmatter({ ...baseFrontmatter, type: "forge-slice-plan" }));
  writeNormalizedPage(absoluteVaultPath(input.vaultRoot, forgeSliceTestPlanPath(input.project, input.sliceId)), renderSliceTestPlanBody(input), orderForgeFrontmatter({ ...baseFrontmatter, type: "forge-slice-test-plan" }));
}

async function nextNumericId(vaultRoot: string, project: string, kind: "feature" | "prd"): Promise<string> {
  const max = await currentMaxNumber(vaultRoot, project, kind);
  const prefix = kind === "feature" ? "FEAT" : "PRD";
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

async function currentMaxNumber(vaultRoot: string, project: string, kind: "feature" | "prd" | "slice"): Promise<number> {
  const dir = absoluteVaultPath(vaultRoot, `${forgeProjectDir(project)}/${planningDirectoryName(kind)}`);
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { withFileTypes: true });
  const pattern = planningIdPattern(project, kind);
  return entries.reduce((max, entry) => {
    const match = entry.name.match(pattern);
    return match ? Math.max(max, Number.parseInt(match[1] ?? "0", 10)) : max;
  }, 0);
}

function planningDirectoryName(kind: "feature" | "prd" | "slice"): "features" | "prds" | "slices" {
  if (kind === "feature") return "features";
  if (kind === "prd") return "prds";
  return "slices";
}

function planningIdPattern(project: string, kind: "feature" | "prd" | "slice"): RegExp {
  if (kind === "feature") return /^FEAT-(\d+)/u;
  if (kind === "prd") return /^PRD-(\d+)/u;
  const projectPrefix = project.replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").toUpperCase();
  return new RegExp(`^${projectPrefix}-(\\d+)`, "u");
}

function planningSessionPath(vaultRoot: string, project: string, featureName: string): string {
  return absoluteVaultPath(vaultRoot, forgePlanningSessionPath(project, planningSessionId(featureName)));
}

function planningSessionId(featureName: string): string {
  return slugify(featureName || "unnamed-feature");
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
  return value.flatMap((entry) => isPlanningAnswer(entry) ? [entry] : []);
}

function readPrds(value: unknown): readonly PlanningPrdCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => isPlanningPrdCandidate(entry) ? [entry] : []);
}

function isPlanningAnswer(value: unknown): value is PlanningAnswer {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && (record.skill === "torpathy" || record.skill === "domain-model" || record.skill === "grill-me")
    && typeof record.response === "string"
    && typeof record.recordedAt === "string";
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

function orderForgeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  return orderFrontmatter(data, [
    "title", "type", "project", "feature_name", "session_id", "feature_id", "prd_id", "task_id",
    "parent_feature", "parent_prd", "planning_session", "status", "created_at", "updated", "answers", "prds", "artifacts", "review_policy",
  ]);
}

function absoluteVaultPath(vaultRoot: string, relativePath: string): string {
  return join(vaultRoot, relativePath);
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "untitled";
}

export function planningSessionRelativePath(project: string, featureName: string): string {
  return relative(VAULT_ROOT, planningSessionPath(VAULT_ROOT, project, featureName)).replaceAll("\\", "/");
}
