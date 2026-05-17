import { mkdir } from "node:fs/promises";
import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso } from "../../cli-shared";
import type { CloseSliceIntent, StartSliceIntent } from "../kernel/intent";
import type { KernelResult } from "../kernel/result";
import { evaluateCloseSliceIntent } from "../lifecycle/forge-close-intent";
import { evaluateStartSliceIntent } from "../lifecycle/forge-start-intent";
import { readForgeEvidence } from "./evidence-store";
import { assertForgeSliceDocumentsMissing, forgeSliceDocumentPaths, nextForgeSequenceId } from "./forge-artifacts";
import { writeAmendmentDocs } from "./amendment-docs";
import { readClosedForgeSliceHub } from "./closed-slice";
import { loadForgeProjectState } from "./slice-project-state";
import { updateSliceFrontmatter } from "./slice-frontmatter";

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
    }, [], input.vaultRoot ?? VAULT_ROOT);
  }
  return result;
}

export async function releaseForgeSlice(input: ReleaseSliceInput): Promise<ReleaseSliceResult> {
  await updateSliceFrontmatter(input.project, input.sliceId, { status: "ready" }, ["claimed_by", "claimed_at"], input.vaultRoot ?? VAULT_ROOT);
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
    }, ["claimed_by", "claimed_at"], input.vaultRoot ?? VAULT_ROOT);
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
  const amendmentSliceId = await nextForgeSequenceId(vaultRoot, input.project, "slice");
  const title = input.title?.trim() || `Amend ${closedSliceId}`;
  const paths = forgeSliceDocumentPaths(vaultRoot, input.project, amendmentSliceId);
  await mkdir(paths.dir, { recursive: true });
  assertForgeSliceDocumentsMissing(paths, amendmentSliceId);
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
    await releaseForgeSlice({ project: input.project, sliceId: amendmentSliceId, vaultRoot });
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

function normalizeVaultPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}
