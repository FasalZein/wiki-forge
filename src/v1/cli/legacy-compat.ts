export type LegacyCompatibilityStatus = "v1-owned" | "legacy-admin" | "legacy-only";

export type LegacyCompatibilityEntry = {
  readonly command: string;
  readonly status: LegacyCompatibilityStatus;
  readonly replacement: string | null;
  readonly reason: string;
};

const V1_OWNED_REASON = "V1-owned command; no legacy fallback";

const LEGACY_COMPATIBILITY_REPORT: readonly LegacyCompatibilityEntry[] = [
  v1Owned("wiki forge next", "wiki v1 forge next"),
  v1Owned("wiki forge status", "wiki v1 forge status"),
  v1Owned("wiki forge start", "wiki v1 forge start"),
  v1Owned("wiki forge release", "wiki v1 forge release"),
  v1Owned("wiki forge evidence", "wiki v1 forge evidence"),
  v1Owned("wiki forge review record", "wiki v1 forge review record"),
  v1Owned("wiki forge check", "wiki v1 forge check"),
  v1Owned("wiki forge close", "wiki v1 forge close"),
  v1Owned("wiki forge run", "wiki v1 forge run"),
  {
    command: "wiki maintain",
    status: "legacy-admin",
    replacement: "wiki legacy maintain",
    reason: "maintenance mutates legacy projections and remains outside V1 lifecycle truth",
  },
];

export function getLegacyCompatibilityReport(): readonly LegacyCompatibilityEntry[] {
  return LEGACY_COMPATIBILITY_REPORT;
}

export function describeLegacyCommand(command: string): LegacyCompatibilityEntry {
  return LEGACY_COMPATIBILITY_REPORT.find((entry) => entry.command === command) ?? {
    command,
    status: "legacy-only",
    replacement: null,
    reason: "no V1 lifecycle replacement declared",
  };
}

function v1Owned(command: string, replacement: string): LegacyCompatibilityEntry {
  return {
    command,
    status: "v1-owned",
    replacement,
    reason: V1_OWNED_REASON,
  };
}
