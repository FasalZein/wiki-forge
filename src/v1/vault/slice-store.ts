import matter from "gray-matter";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import type { StartSliceIntent } from "../kernel/intent";
import type { KernelResult } from "../kernel/result";
import { evaluateStartSliceIntent } from "../forge/start-slice-intent";
import type { ForgeProjectState } from "../forge/types";
import { readProjectSliceDocuments } from "./load-project";
import { classifyLegacyDocument } from "./legacy-classifier";
import { parseVaultDocument } from "./frontmatter-codec";

export type V1StartSliceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly agent: string;
  readonly now?: string;
  readonly vaultRoot?: string;
};

export type V1ReleaseSliceInput = {
  readonly project: string;
  readonly sliceId: string;
  readonly vaultRoot?: string;
};

export type V1ReleaseSliceResult = {
  readonly status: "released";
  readonly project: string;
  readonly sliceId: string;
};

export async function startV1Slice(input: V1StartSliceInput): Promise<KernelResult> {
  const now = input.now ?? new Date().toISOString();
  const state = await loadForgeProjectState(input.project, input.vaultRoot);
  const intent: StartSliceIntent = {
    kind: "intent",
    id: `start:${input.project}:${input.sliceId}:${now}`,
    type: "start-slice",
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

export async function releaseV1Slice(input: V1ReleaseSliceInput): Promise<V1ReleaseSliceResult> {
  await updateSliceFrontmatter(input.project, input.sliceId, { status: "ready" }, ["claimed_by", "claimed_at"], input.vaultRoot);
  return {
    status: "released",
    project: input.project,
    sliceId: input.sliceId,
  };
}

export async function loadForgeProjectState(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeProjectState> {
  const documents = await readProjectSliceDocuments(project, vaultRoot);
  return {
    project,
    activeSlices: documents.flatMap((document) => {
      const classification = classifyLegacyDocument(parseVaultDocument(document.path, document.markdown));
      if (classification.status !== "valid" || classification.record.kind !== "slice" || classification.record.status !== "in-progress") return [];
      const claimedBy = readClaimedBy(document.markdown);
      return [{
        project,
        sliceId: classification.record.taskId,
        ...(claimedBy ? { claimedBy } : {}),
      }];
    }),
  };
}

async function updateSliceFrontmatter(
  project: string,
  sliceId: string,
  updates: Record<string, string>,
  removals: readonly string[],
  vaultRoot = VAULT_ROOT,
): Promise<void> {
  const path = sliceIndexPath(vaultRoot, project, sliceId);
  if (!existsSync(path)) throw new Error(`slice index not found: ${project}/${sliceId}`);
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);
  const data = { ...parsed.data, ...updates };
  for (const key of removals) delete data[key];
  await writeFile(path, matter.stringify(parsed.content, data), "utf8");
}

function sliceIndexPath(vaultRoot: string, project: string, sliceId: string): string {
  return join(vaultRoot, "projects", project, "specs", "slices", sliceId, "index.md");
}

function readClaimedBy(markdown: string): string | null {
  const parsed = matter(markdown);
  const value = parsed.data.claimed_by;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
