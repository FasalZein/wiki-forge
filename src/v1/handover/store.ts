import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { renderV1HandoverMarkdown } from "./render";
import type { V1HandoverRecord } from "./schema";
import { forgeHandoverPath, forgeProjectDir } from "../vault/forge-paths";
import { parseVaultDocument } from "../vault/frontmatter-codec";
import { decodeV1ForgeRecord } from "../vault/records";

export type WriteV1HandoverInput = {
  readonly project: string;
  readonly sessionId: string;
  readonly agent: string;
  readonly summary: string;
  readonly nextAction: string;
  readonly copyPastePrompt: string;
  readonly relatedFeatures: readonly string[];
  readonly relatedPrds: readonly string[];
  readonly relatedSlices: readonly string[];
  readonly createdAt?: string;
  readonly vaultRoot?: string;
};

export type WriteV1HandoverResult = {
  readonly status: "written";
  readonly project: string;
  readonly path: string;
  readonly handover: V1HandoverRecord;
};

export async function readLatestV1Handover(project: string, vaultRoot = VAULT_ROOT): Promise<V1HandoverRecord | null> {
  const relativeDir = `${forgeProjectDir(project)}/handovers`;
  const absoluteDir = join(vaultRoot, relativeDir);
  let files: string[];
  try {
    files = await readdir(absoluteDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  for (const file of files.filter((candidate) => candidate.endsWith(".md")).sort().reverse()) {
    const path = `${relativeDir}/${file}`;
    const markdown = await readFile(join(vaultRoot, path), "utf8");
    const decoded = decodeV1ForgeRecord(parseVaultDocument(path, markdown));
    if (decoded.status === "valid" && decoded.record.kind === "handover") return decoded.record;
  }
  return null;
}

export async function writeV1Handover(input: WriteV1HandoverInput): Promise<WriteV1HandoverResult> {
  const path = forgeHandoverPath(input.project, input.sessionId);
  const handover: V1HandoverRecord = {
    kind: "handover",
    path,
    title: `${input.sessionId} handover`,
    project: input.project,
    sessionId: input.sessionId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    agent: input.agent,
    relatedFeatures: input.relatedFeatures,
    relatedPrds: input.relatedPrds,
    relatedSlices: input.relatedSlices,
    summary: input.summary,
    nextAction: input.nextAction,
    copyPastePrompt: input.copyPastePrompt,
  };
  const absolutePath = join(input.vaultRoot ?? VAULT_ROOT, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${renderV1HandoverMarkdown(handover)}\n`, "utf8");
  return { status: "written", project: input.project, path, handover };
}
