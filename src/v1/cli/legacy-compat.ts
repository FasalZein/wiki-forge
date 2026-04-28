export type LegacyCompatibilityStatus = "v1-compatible" | "legacy-admin" | "legacy-only";

export type LegacyCompatibilityEntry = {
  readonly command: string;
  readonly status: LegacyCompatibilityStatus;
  readonly replacement: string | null;
  readonly reason: string;
};

const LEGACY_COMPATIBILITY_REPORT: readonly LegacyCompatibilityEntry[] = [
  {
    command: "wiki forge next",
    status: "v1-compatible",
    replacement: "wiki v1 forge next",
    reason: "same read-only lifecycle projection semantics",
  },
  {
    command: "wiki forge status",
    status: "v1-compatible",
    replacement: "wiki v1 forge status",
    reason: "same read-only lifecycle projection semantics",
  },
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
