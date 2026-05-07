import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VAULT_ROOT } from "../../../constants";
import { renderForgeHandoverMarkdown } from "./render";
import type { ForgeHandoverRecord } from "./schema";
import { forgeHandoverPath, forgeProjectDir } from "../../../forge/vault/forge-paths";
import { parseVaultDocument } from "../../../forge/vault/frontmatter-codec";
import { decodeForgeRecord } from "../../../forge/vault/records";

export type WriteHandoverInput = {
  readonly project: string;
  readonly sessionId: string;
  readonly agent: string;
  readonly summary: string;
  readonly nextAction: string;
  readonly copyPastePrompt: string;
  readonly baseRevision?: string;
  readonly runbookCommands?: readonly string[];
  readonly relatedFeatures: readonly string[];
  readonly relatedPrds: readonly string[];
  readonly relatedSlices: readonly string[];
  readonly createdAt?: string;
  readonly vaultRoot?: string;
};

export type WriteHandoverResult = {
  readonly status: "written";
  readonly project: string;
  readonly path: string;
  readonly handover: ForgeHandoverRecord;
};

export async function readLatestForgeHandover(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeHandoverRecord | null> {
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
    const decoded = decodeForgeRecord(parseVaultDocument(path, markdown));
    if (decoded.status === "valid" && decoded.record.kind === "handover") return decoded.record;
  }
  return null;
}

export async function writeForgeHandover(input: WriteHandoverInput): Promise<WriteHandoverResult> {
  const path = forgeHandoverPath(input.project, input.sessionId);
  const handover: ForgeHandoverRecord = {
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
    ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
    ...(input.runbookCommands && input.runbookCommands.length > 0 ? { runbookCommands: input.runbookCommands } : {}),
  };
  const absolutePath = join(input.vaultRoot ?? VAULT_ROOT, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${renderForgeHandoverMarkdown(handover)}\n`, "utf8");
  return { status: "written", project: input.project, path, handover };
}
