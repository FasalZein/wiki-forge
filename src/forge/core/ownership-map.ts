import { bindingMatchesFile, normalizeRelPath } from "../../git-utils";

export const SLICE_OWNERSHIP_KINDS = [
  "ignored-generated",
  "active-slice",
  "other-open-slice",
  "closed-slice-amendment",
  "unowned",
] as const;

export type SliceOwnershipKind = typeof SLICE_OWNERSHIP_KINDS[number];

export const DEFAULT_IGNORED_GENERATED_PATH_SEGMENTS = [
  ".venv",
  "node_modules",
  ".local-dev",
  "site-packages",
  "coverage",
  "dist",
  "build",
  ".qa-screens",
  "__pycache__",
] as const;

export type SliceOwnershipEntry = {
  file: string;
  kind: SliceOwnershipKind;
  matchedClaimPath?: string;
  ownerSliceId?: string;
};

export type SliceOwnershipMap = {
  activeSliceId: string | null;
  entries: SliceOwnershipEntry[];
  counts: Record<SliceOwnershipKind, number>;
};

export type ClosedSliceAmendmentClaim = {
  sliceId: string;
  claimPaths: string[];
};

export function collectSliceOwnershipMap(input: {
  changedFiles: string[];
  activeSliceId?: string | null;
  activeClaimPaths?: string[];
  closedSliceAmendments?: ClosedSliceAmendmentClaim[];
}): SliceOwnershipMap {
  const activeSliceId = input.activeSliceId ?? null;
  const activeClaimPaths = normalizeClaimPaths(input.activeClaimPaths ?? []);
  const closedSliceAmendments = (input.closedSliceAmendments ?? [])
    .map((amendment) => ({ sliceId: amendment.sliceId, claimPaths: normalizeClaimPaths(amendment.claimPaths) }))
    .filter((amendment) => amendment.sliceId && amendment.claimPaths.length > 0);
  const entries = [...new Set(input.changedFiles.map(normalizeRelPath).filter(Boolean))]
    .sort()
    .map((file) => classifyChangedFileOwnership(file, activeSliceId, activeClaimPaths, closedSliceAmendments));
  const counts = createOwnershipCounts();
  for (const entry of entries) counts[entry.kind] += 1;
  return { activeSliceId, entries, counts };
}

export function classifyChangedFileOwnership(
  file: string,
  activeSliceId: string | null,
  activeClaimPaths: string[],
  closedSliceAmendments: ClosedSliceAmendmentClaim[] = [],
): SliceOwnershipEntry {
  const normalizedFile = normalizeRelPath(file);
  if (isIgnoredGeneratedPath(normalizedFile)) return { file: normalizedFile, kind: "ignored-generated" };

  if (activeSliceId && isTestSupportPath(normalizedFile)) {
    return {
      file: normalizedFile,
      kind: "active-slice",
      matchedClaimPath: "test-support",
      ownerSliceId: activeSliceId,
    };
  }

  const closedAmendment = closedSliceAmendments
    .map((amendment) => ({
      sliceId: amendment.sliceId,
      matchedClaimPath: amendment.claimPaths.find((claimPath) => bindingMatchesFile(claimPath, normalizedFile)),
    }))
    .find((amendment) => amendment.matchedClaimPath);
  if (closedAmendment?.matchedClaimPath) {
    return {
      file: normalizedFile,
      kind: "closed-slice-amendment",
      matchedClaimPath: closedAmendment.matchedClaimPath,
      ownerSliceId: closedAmendment.sliceId,
    };
  }

  const matchedClaimPath = activeClaimPaths.find((claimPath) => bindingMatchesFile(claimPath, normalizedFile));
  if (activeSliceId && matchedClaimPath) {
    return {
      file: normalizedFile,
      kind: "active-slice",
      matchedClaimPath,
      ownerSliceId: activeSliceId,
    };
  }

  return { file: normalizedFile, kind: "unowned" };
}

export function isTestSupportPath(file: string) {
  const normalized = normalizeRelPath(file);
  return normalized.startsWith("tests/")
    || /(^|\/)__tests__\//u.test(normalized)
    || /\.(test|spec)\.[cm]?[jt]sx?$/u.test(normalized);
}

export function isIgnoredGeneratedPath(file: string) {
  const segments = normalizeRelPath(file).split("/").filter(Boolean);
  return segments.some((segment) => DEFAULT_IGNORED_GENERATED_PATH_SEGMENTS.includes(segment as typeof DEFAULT_IGNORED_GENERATED_PATH_SEGMENTS[number]));
}

function normalizeClaimPaths(paths: string[]) {
  return [...new Set(paths.map(normalizeRelPath).map((path) => path.replace(/\/+$/u, "")).filter(Boolean))].sort();
}

function createOwnershipCounts(): Record<SliceOwnershipKind, number> {
  return {
    "ignored-generated": 0,
    "active-slice": 0,
    "other-open-slice": 0,
    "closed-slice-amendment": 0,
    unowned: 0,
  };
}
