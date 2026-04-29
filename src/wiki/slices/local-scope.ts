import { bindingMatchesFile } from "../../git-utils";
import { readSliceHub, readSliceSourcePaths } from "./readers";

type DiagnosticScope = "slice" | "parent" | "project" | "history";

export type SliceLocalContext = {
  sliceId: string;
  claimPaths: string[];
  amendedClosedSliceId: string | null;
  amendedClosedSliceClaimPaths: string[];
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
  const amendedClosedSliceId = typeof hub.data.amendment_of === "string" && hub.data.amendment_of.trim()
    ? hub.data.amendment_of.trim().toUpperCase()
    : null;
  const amendedClosedSliceClaimPaths = amendedClosedSliceId ? await readSliceSourcePaths(project, amendedClosedSliceId) : [];
  const parentPrd = typeof hub.data.parent_prd === "string" ? hub.data.parent_prd : null;
  const parentFeature = typeof hub.data.parent_feature === "string" ? hub.data.parent_feature : null;
  const parentPrdPage = parentPrd
    ? pageEntries?.find((entry) => entry.parsed?.data.prd_id === parentPrd)?.page ?? null
    : null;
  const parentFeaturePage = parentFeature
    ? pageEntries?.find((entry) => entry.parsed?.data.feature_id === parentFeature)?.page ?? null
    : null;
  return { sliceId, claimPaths, amendedClosedSliceId, amendedClosedSliceClaimPaths, parentPrd, parentFeature, parentPrdPage, parentFeaturePage };
}

export function classifySliceLocalPageScope(page: string, context: SliceLocalContext): DiagnosticScope {
  if (page.startsWith(`specs/slices/${context.sliceId}/`)) return "slice";
  if (page === context.parentPrdPage || page === context.parentFeaturePage) return "parent";
  return "project";
}

export function fileMatchesSliceClaims(file: string, context: SliceLocalContext) {
  const claimPaths = [...context.claimPaths, ...context.amendedClosedSliceClaimPaths];
  return claimPaths.some((claimPath) => bindingMatchesFile(claimPath, file));
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).replaceAll("\\", "/").trim()).filter(Boolean)
    : [];
}
