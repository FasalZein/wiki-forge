export type LegacyCompatibilityStatus = "v1-owned" | "legacy-admin" | "legacy-only";

export type LegacyCompatibilityEntry = {
  readonly command: string;
  readonly status: LegacyCompatibilityStatus;
  readonly replacement: string | null;
  readonly reason: string;
};

const FORGE_OWNED_REASON = "Forge-owned command; no legacy fallback";

const LEGACY_COMPATIBILITY_REPORT: readonly LegacyCompatibilityEntry[] = [
  v1Owned("wiki forge next", "wiki forge next"),
  v1Owned("wiki forge status", "wiki forge status"),
  v1Owned("wiki forge plan", "wiki forge plan"),
  v1Owned("wiki forge start", "wiki forge start"),
  v1Owned("wiki forge release", "wiki forge release"),
  v1Owned("wiki forge evidence", "wiki forge evidence"),
  v1Owned("wiki forge review record", "wiki forge review record"),
  v1Owned("wiki forge check", "wiki forge check"),
  v1Owned("wiki forge amend", "wiki forge amend"),
  v1Owned("wiki forge close", "wiki forge close"),
  v1Owned("wiki forge run", "wiki forge run"),
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
    reason: FORGE_OWNED_REASON,
  };
}
