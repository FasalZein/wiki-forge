import type { VaultPath } from "./path";

export function forgeProjectDir(project: string): VaultPath {
  return `projects/${normalizeSegment(project)}/forge`;
}

export function forgeFeaturePath(project: string, featureId: string, slug: string): VaultPath {
  return `${forgeProjectDir(project)}/features/${normalizeSegment(featureId)}-${normalizeSlug(slug)}.md`;
}

export function forgePrdPath(project: string, prdId: string, slug: string): VaultPath {
  return `${forgeProjectDir(project)}/prds/${normalizeSegment(prdId)}-${normalizeSlug(slug)}.md`;
}

export function forgeSliceDir(project: string, sliceId: string): VaultPath {
  return `${forgeProjectDir(project)}/slices/${normalizeSegment(sliceId)}`;
}

export function forgeSlicePath(project: string, sliceId: string): VaultPath {
  return `${forgeSliceDir(project, sliceId)}/index.md`;
}

export function forgeSlicePlanPath(project: string, sliceId: string): VaultPath {
  return `${forgeSliceDir(project, sliceId)}/plan.md`;
}

export function forgeSliceTestPlanPath(project: string, sliceId: string): VaultPath {
  return `${forgeSliceDir(project, sliceId)}/test-plan.md`;
}

export function forgeEvidencePath(project: string, sliceId: string): VaultPath {
  return `${forgeProjectDir(project)}/evidence/${normalizeSegment(sliceId)}.md`;
}

export function forgePlanningSessionPath(project: string, sessionId: string): VaultPath {
  return `${forgeProjectDir(project)}/sessions/${normalizeSegment(sessionId)}.md`;
}

export function forgeHandoverPath(project: string, sessionId: string): VaultPath {
  return `${forgeProjectDir(project)}/handovers/${normalizeSegment(sessionId)}.md`;
}

export function isForgePath(path: VaultPath): boolean {
  const normalized = normalizePath(path);
  return /^projects\/[^/]+\/forge\/[^/]+(?:\/.*)?$/u.test(normalized);
}

export function isForgeFeaturePath(path: VaultPath): boolean {
  return /^projects\/[^/]+\/forge\/features\/[^/]+\.md$/u.test(normalizePath(path));
}

export function isForgePrdPath(path: VaultPath): boolean {
  return /^projects\/[^/]+\/forge\/prds\/[^/]+\.md$/u.test(normalizePath(path));
}

export function isForgeSlicePath(path: VaultPath): boolean {
  return /^projects\/[^/]+\/forge\/slices\/[^/]+\/index\.md$/u.test(normalizePath(path));
}

export function isForgeEvidencePath(path: VaultPath): boolean {
  return /^projects\/[^/]+\/forge\/evidence\/[^/]+\.md$/u.test(normalizePath(path));
}

export function isForgeHandoverPath(path: VaultPath): boolean {
  return /^projects\/[^/]+\/forge\/handovers\/[^/]+\.md$/u.test(normalizePath(path));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function normalizeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`invalid forge path segment: ${value}`);
  return trimmed;
}

function normalizeSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "untitled";
}
