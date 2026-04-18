import { bindingMatchesFile } from "../git-utils";
import type { DiagnosticScope } from "./diagnostics";
import { readSliceHub } from "./slices";

export type SliceLocalContext = {
  sliceId: string;
  claimPaths: string[];
  parentPrd: string | null;
  parentFeature: string | null;
  parentPrdPage: string | null;
  parentFeaturePage: string | null;
};

export async function collectSliceLocalContext(
  project: string,
  sliceId: string,
  pageEntries?: Array<{ page: string; parsed: { data: Record<string, unknown> } | null }>,
): Promise<SliceLocalContext> {
  const hub = await readSliceHub(project, sliceId);
  const claimPaths = readStringArray(hub.data.claim_paths).length
    ? readStringArray(hub.data.claim_paths)
    : readStringArray(hub.data.source_paths);
  const parentPrd = typeof hub.data.parent_prd === "string" ? hub.data.parent_prd : null;
  const parentFeature = typeof hub.data.parent_feature === "string" ? hub.data.parent_feature : null;
  const parentPrdPage = parentPrd
    ? pageEntries?.find((entry) => entry.parsed?.data.prd_id === parentPrd)?.page ?? null
    : null;
  const parentFeaturePage = parentFeature
    ? pageEntries?.find((entry) => entry.parsed?.data.feature_id === parentFeature)?.page ?? null
    : null;
  return { sliceId, claimPaths, parentPrd, parentFeature, parentPrdPage, parentFeaturePage };
}

export function classifySliceLocalPageScope(page: string, context: SliceLocalContext): DiagnosticScope {
  if (page.startsWith(`specs/slices/${context.sliceId}/`)) return "slice";
  if (page === context.parentPrdPage || page === context.parentFeaturePage) return "parent";
  return "project";
}

export function fileMatchesSliceClaims(file: string, context: SliceLocalContext) {
  return context.claimPaths.some((claimPath) => bindingMatchesFile(claimPath, file));
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).replaceAll("\\", "/").trim()).filter(Boolean)
    : [];
}
