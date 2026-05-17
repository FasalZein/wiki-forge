import matter from "gray-matter";
import { VAULT_ROOT } from "../../constants";
import type { ForgeProjectState } from "../lifecycle/types";
import { readProjectSliceDocuments } from "./load-project";
import { decodeForgeRecord, parseVaultDocument } from "./records";

export async function loadForgeProjectState(project: string, vaultRoot = VAULT_ROOT): Promise<ForgeProjectState> {
  const documents = await readProjectSliceDocuments(project, vaultRoot);
  const sliceStatuses: Record<string, "draft" | "ready" | "in-progress" | "done" | "cancelled"> = {};
  const activeSlices = documents.flatMap((document) => {
    const decoded = decodeForgeRecord(parseVaultDocument(document.path, document.markdown));
    if (decoded.status !== "valid" || decoded.record.kind !== "slice") return [];
    sliceStatuses[decoded.record.taskId] = decoded.record.status;
    if (decoded.record.status !== "in-progress") return [];
    const claimedBy = readClaimedBy(document.markdown);
    return [{
      project,
      sliceId: decoded.record.taskId,
      ...(claimedBy ? { claimedBy } : {}),
    }];
  });
  return {
    project,
    activeSlices,
    sliceStatuses,
  };
}

function readClaimedBy(markdown: string): string | null {
  const parsed = matter(markdown);
  const value = parsed.data.claimed_by;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
