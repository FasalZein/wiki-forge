import matter from "gray-matter";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, writeNormalizedPage } from "../../cli-shared";
import type { CloseSliceIntent, StartSliceIntent } from "../kernel/intent";
import type { KernelResult } from "../kernel/result";
import { evaluateCloseSliceIntent } from "../lifecycle/forge-close-intent";
import { evaluateStartSliceIntent } from "../lifecycle/forge-start-intent";
import { evaluateReviewGate } from "../lifecycle/review-gate";
import { hasPassedTargetedVerification, hasPassedTddEvidence } from "../lifecycle/verification-gate";
import type { ForgeProjectState } from "../lifecycle/types";
import { readProjectSliceDocuments } from "./load-project";
import { parseVaultDocument } from "./frontmatter-codec";
import { readForgeEvidence } from "./evidence-store";
import { decodeForgeRecord } from "./records";
import { nextSliceId, readAllSliceIds, readSliceHub, sliceDocPaths, updateSliceHub } from "./slice-repository";

export type StartSliceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly agent: string;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export type ReleaseSliceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly vaultRoot?: string;
};

export type CloseSliceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly closedBy: string;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export type AmendSliceInput = {
  readonly project: string;
  readonly closedSliceId: string;
  readonly reason: string;
  readonly title?: string;
  readonly agent?: string;
  readonly sourcePaths?: readonly string[];
  readonly start?: boolean;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export type ReleaseSliceResult = {
  readonly status: "released";
  readonly project: string;
  readonly sliceId: string;
};

export type AmendSliceResult = {
  readonly project: string;
  readonly closedSliceId: string;
  readonly amendmentSliceId: string;
  readonly reason: string;
  readonly sourcePaths: readonly string[];
  readonly started: boolean;
  readonly startedAt?: string;
  readonly paths: {
    readonly index: string;
    readonly plan: string;
    readonly testPlan: string;
  };
};

export async function startForgeSlice(input: StartSliceInput): Promise<KernelResult> {
  const now = input.now ?? new Date().toISOString();
  const state = await loadForgeProjectState(input.project, input.vaultRoot);
  const intent: StartSliceIntent = {
    kind: "intent",
    id: `start:${input.project}:${input.sliceId}:${now}`,
    type: "forge-start",
    actor: { kind: "agent", id: input.agent },
    context: {
      project: input.project,
      sliceId: input.sliceId,
      requestedAt: now,
    },
    payload: {
      sliceId: input.sliceId,
      agent: input.agent,
    },
  };
  const result = evaluateStartSliceIntent(intent, state);
  if (result.status === "accepted") {
    await updateSliceFrontmatter(input.project, input.sliceId, {
      status: "in-progress",
      claimed_by: input.agent,
      claimed_at: now,
    }, [], input.vaultRoot);
  }
  return result;
}

export async function releaseForgeSlice(input: ReleaseSliceInput): Promise<ReleaseSliceResult> {
  await updateSliceFrontmatter(input.project, input.sliceId, { status: "ready" }, ["claimed_by", "claimed_at"], input.vaultRoot);
  return {
    status: "released",
    project: input.project,
    sliceId: input.sliceId,
  };
}

export async function checkForgeSliceClose(input: CloseSliceInput): Promise<KernelResult> {
  const now = input.now ?? new Date().toISOString();
  const intent: CloseSliceIntent = {
    kind: "intent",
    id: `close:${input.project}:${input.sliceId}:${now}`,
    type: "forge-close",
    actor: { kind: "agent", id: input.closedBy },
    context: {
      project: input.project,
      sliceId: input.sliceId,
      requestedAt: now,
    },
    payload: {
      sliceId: input.sliceId,
      closedBy: input.closedBy,
    },
  };
  return evaluateCloseSliceIntent(intent, {
    project: input.project,
    sliceId: input.sliceId,
    evidence: await readForgeEvidence(input.project, input.sliceId, input.vaultRoot),
    reviewPolicy: { required: true },
  });
}

export async function closeForgeSlice(input: CloseSliceInput): Promise<KernelResult> {
  const now = input.now ?? new Date().toISOString();
  const result = await checkForgeSliceClose({ ...input, now });
  if (result.status === "accepted") {
    await updateSliceFrontmatter(input.project, input.sliceId, {
      status: "done",
      closed_by: input.closedBy,
      closed_at: now,
      forge_closure_evidence: ["tdd", "verification", "review"],
    }, ["claimed_by", "claimed_at"], input.vaultRoot);
  }
  return result;
}

export async function amendForgeSlice(input: AmendSliceInput): Promise<AmendSliceResult> {
  const vaultRoot = input.vaultRoot ?? VAULT_ROOT;
  const now = input.now ?? nowIso();
  const closedSliceId = input.closedSliceId.trim().toUpperCase();
  const closedHub = await readClosedForgeSliceHub(input.project, closedSliceId, vaultRoot);
  const inheritedSourcePaths = input.sourcePaths?.length
    ? normalizeSourcePaths(input.sourcePaths)
    : normalizeSourcePaths(readStringArray(closedHub.frontmatter.source_paths));
  const amendmentSliceId = await nextForgeSliceId(vaultRoot, input.project);
  const title = input.title?.trim() || `Amend ${closedSliceId}`;
  const paths = sliceDocPaths(vaultRoot, input.project, amendmentSliceId);
  await mkdir(paths.dir, { recursive: true });
  await assertAmendmentDocsMissing(paths, amendmentSliceId);
  const parentPrd = readString(closedHub.frontmatter.parent_prd);
  const parentFeature = readString(closedHub.frontmatter.parent_feature);

  writeAmendmentDocs({
    project: input.project,
    closedSliceId,
    amendmentSliceId,
    title,
    reason: input.reason,
    createdAt: now,
    sourcePaths: inheritedSourcePaths,
    parentPrd,
    parentFeature,
    paths,
  });

  let startedAt: string | undefined;
  if (input.start) {
    const agent = input.agent?.trim() || "agent";
    const result = await startForgeSlice({ project: input.project, sliceId: amendmentSliceId, agent, now, vaultRoot });
    if (result.status === "rejected") throw new Error(result.rejection.reason);
    startedAt = now;
  }

  return {
    project: input.project,
    closedSliceId,
    amendmentSliceId,
    reason: input.reason,
    sourcePaths: inheritedSourcePaths,
    started: input.start === true,
    ...(startedAt ? { startedAt } : {}),
    paths: {
      index: normalizeVaultPath(relative(vaultRoot, paths.indexPath)),
      plan: normalizeVaultPath(relative(vaultRoot, paths.planPath)),
      testPlan: normalizeVaultPath(relative(vaultRoot, paths.testPlanPath)),
    },
  };
}

export async function loadForgeProjectState(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeProjectState> {
  const documents = await readProjectSliceDocuments(project, vaultRoot);
  return {
    project,
    activeSlices: documents.flatMap((document) => {
      const decoded = decodeForgeRecord(parseVaultDocument(document.path, document.markdown));
      if (decoded.status !== "valid" || decoded.record.kind !== "slice" || decoded.record.status !== "in-progress") return [];
      const claimedBy = readClaimedBy(document.markdown);
      return [{
        project,
        sliceId: decoded.record.taskId,
        ...(claimedBy ? { claimedBy } : {}),
      }];
    }),
  };
}

async function updateSliceFrontmatter(
  project: string,
  sliceId: string,
  updates: Record<string, unknown>,
  removals: readonly string[],
  vaultRoot = VAULT_ROOT,
): Promise<void> {
  await updateSliceHub(vaultRoot, project, sliceId, updates, removals);
}

async function readClosedForgeSliceHub(project: string, sliceId: string, vaultRoot: string) {
  const hub = await readSliceHub(vaultRoot, project, sliceId);
  const document = parseVaultDocument(hub.path, hub.markdown);
  const decoded = decodeForgeRecord(document);
  if (decoded.status !== "valid" || decoded.record.kind !== "slice" || decoded.record.taskId !== sliceId) {
    throw new Error(`slice is not a Forge canonical slice record: ${project}/${sliceId}`);
  }
  if (decoded.record.status !== "done") {
    throw new Error(`cannot amend ${sliceId}: slice is not closed in Forge lifecycle truth`);
  }
  const evidence = await readForgeEvidence(project, sliceId, vaultRoot);
  if (!hasRequiredCloseEvidence(hub.data, evidence)) {
    throw new Error(`cannot amend ${sliceId}: slice is not closed in Forge lifecycle truth`);
  }
  return document;
}

function hasRequiredCloseEvidence(data: Record<string, unknown>, evidence: Awaited<ReturnType<typeof readForgeEvidence>>): boolean {
  const closureEvidence = readStringArray(data.forge_closure_evidence ?? data.closure_evidence);
  const hasClosureStamp = ["tdd", "verification", "review"].every((kind) => closureEvidence.includes(kind));
  if (hasClosureStamp) return true;
  return hasPassedTddEvidence(evidence)
    && hasPassedTargetedVerification(evidence)
    && evaluateReviewGate(evidence, { required: true }).status === "approved";
}

async function nextForgeSliceId(vaultRoot: string, project: string): Promise<string> {
  return nextSliceId(await readAllSliceIds(vaultRoot, project), project);
}

async function assertAmendmentDocsMissing(paths: ReturnType<typeof sliceDocPaths>, sliceId: string): Promise<void> {
  if (existsSync(paths.indexPath) || existsSync(paths.planPath) || existsSync(paths.testPlanPath)) {
    throw new Error(`slice docs already exist for ${sliceId}: ${normalizeVaultPath(paths.dir)}`);
  }
}

type WriteAmendmentDocsInput = {
  readonly project: string;
  readonly closedSliceId: string;
  readonly amendmentSliceId: string;
  readonly title: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly sourcePaths: readonly string[];
  readonly parentPrd: string | null;
  readonly parentFeature: string | null;
  readonly paths: ReturnType<typeof sliceDocPaths>;
};

function writeAmendmentDocs(input: WriteAmendmentDocsInput): void {
  const hubLink = sliceDocVaultLink(input.project, input.amendmentSliceId, "index");
  const planLink = sliceDocVaultLink(input.project, input.amendmentSliceId, "plan");
  const testPlanLink = sliceDocVaultLink(input.project, input.amendmentSliceId, "test-plan");
  const closedLink = sliceDocVaultLink(input.project, input.closedSliceId, "index");
  const baseFrontmatter = {
    title: `${input.amendmentSliceId} ${input.title}`,
    type: "forge-slice",
    project: input.project,
    source_paths: input.sourcePaths,
    task_id: input.amendmentSliceId,
    depends_on: [input.closedSliceId],
    amendment_of: input.closedSliceId,
    amendment_reason: input.reason,
    amendment_created_at: input.createdAt,
    ...(input.parentPrd ? { parent_prd: input.parentPrd } : {}),
    ...(input.parentFeature ? { parent_feature: input.parentFeature } : {}),
    created_at: input.createdAt,
    updated: input.createdAt,
    status: "draft",
  };

  writeNormalizedPage(input.paths.indexPath, [
    `# ${input.amendmentSliceId} — ${input.title}`,
    "",
    "> [!summary]",
    `> Forge amendment slice for ${input.closedSliceId}. The closed slice remains immutable; this slice carries follow-up work.`,
    "",
    "## Amendment",
    "",
    `- Amends closed slice: [[${closedLink}|${input.closedSliceId}]]`,
    `- Reason: ${input.reason}`,
    "- Do not reopen or edit the closed slice; this amendment carries the follow-up work.",
    "",
    "## Documents",
    "",
    `- [[${planLink}]]`,
    `- [[${testPlanLink}]]`,
    "",
    "## Cross Links",
    "",
    `- [[projects/${input.project}/forge/slices/${input.amendmentSliceId}/index]]`,
  ].join("\n"), orderForgeSliceFrontmatter({ ...baseFrontmatter, review_policy: { required_approvals: 1 } }));

  writeNormalizedPage(input.paths.planPath, [
    `# ${input.amendmentSliceId} ${input.title}`,
    "",
    "> [!summary]",
    `> Execution plan for Forge amendment ${input.amendmentSliceId}.`,
    "",
    "## Amendment Context",
    "",
    `- Closed slice: [[${closedLink}|${input.closedSliceId}]]`,
    `- Reason: ${input.reason}`,
    "- Preserve the original close evidence; scope only the follow-up change here.",
    "",
    "## Scope",
    "",
    "- ",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] ",
    "",
    "## Cross Links",
    "",
    `- [[${hubLink}]]`,
    `- [[${testPlanLink}]]`,
  ].join("\n"), orderForgeSliceFrontmatter({ ...baseFrontmatter, type: "forge-slice-plan" }));

  writeNormalizedPage(input.paths.testPlanPath, [
    `# ${input.amendmentSliceId} ${input.title}`,
    "",
    "> [!summary]",
    `> Regression checklist for Forge amendment ${input.amendmentSliceId}.`,
    "",
    "## Amendment Verification Context",
    "",
    `- Closed slice: [[${closedLink}|${input.closedSliceId}]]`,
    `- Reason: ${input.reason}`,
    "- Add regression coverage that proves the amended behavior without mutating prior close evidence.",
    "",
    "## Red Tests",
    "",
    "- [ ] ",
    "",
    "## Green Criteria",
    "",
    "- [ ] ",
    "",
    "## Verification Commands",
    "",
    "```bash",
    "# add one or more repo-root commands that prove this amendment is done",
    "```",
    "",
    "## Cross Links",
    "",
    `- [[${hubLink}]]`,
    `- [[${planLink}]]`,
  ].join("\n"), orderForgeSliceFrontmatter({ ...baseFrontmatter, type: "forge-slice-test-plan" }));
}

function orderForgeSliceFrontmatter(data: Record<string, unknown>) {
  return orderFrontmatter(data, [
    "title", "type", "project", "source_paths", "task_id",
    "depends_on", "amendment_of", "amendment_reason", "amendment_created_at",
    "parent_prd", "parent_feature", "created_at", "updated", "status", "review_policy",
    "claimed_by", "claimed_at",
  ]);
}

function normalizeSourcePaths(sourcePaths: readonly string[]): readonly string[] {
  return [...new Set(sourcePaths.map((sourcePath) => sourcePath.replaceAll("\\", "/").trim()).filter(Boolean))].sort();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : []);
}

function readTimestampValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

function sliceDocVaultLink(project: string, sliceId: string, kind: "index" | "plan" | "test-plan"): string {
  return `projects/${project}/forge/slices/${sliceId}/${kind}`;
}

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readClaimedBy(markdown: string): string | null {
  const parsed = matter(markdown);
  const value = parsed.data.claimed_by;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
