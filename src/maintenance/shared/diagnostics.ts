export type DiagnosticScope = "slice" | "parent" | "project" | "history";
export type DiagnosticSeverity = "blocker" | "warning";
export type DiagnosticBlockingSeverity = "hard" | "soft";

export const DIAGNOSTIC_BLOCKING_SEVERITY: Record<DiagnosticSeverity, DiagnosticBlockingSeverity> = {
  blocker: "hard",
  warning: "soft",
};

export type DiagnosticFinding = {
  scope: DiagnosticScope;
  severity: DiagnosticSeverity;
  blockingSeverity?: DiagnosticBlockingSeverity;
  message: string;
};

export type GroupedDiagnostics = {
  blockers: DiagnosticFinding[];
  actionableWarnings: DiagnosticFinding[];
  projectDebtWarnings: DiagnosticFinding[];
  historicalWarnings: DiagnosticFinding[];
  counts: {
    blockers: number;
    actionableWarnings: number;
    projectDebtWarnings: number;
    historicalWarnings: number;
  };
};

export type MaintenanceAction = {
  kind: string;
  scope?: DiagnosticScope;
  message: string;
  _apply?: () => void;
};

export function formatMaintenanceActionLabel(action: Pick<MaintenanceAction, "kind" | "scope">) {
  return action.scope ? `[${action.scope}][${action.kind}]` : `[${action.kind}]`;
}

export function classifyDiagnosticFinding(finding: DiagnosticFinding): DiagnosticFinding & { blockingSeverity: DiagnosticBlockingSeverity } {
  return {
    ...finding,
    blockingSeverity: finding.blockingSeverity ?? DIAGNOSTIC_BLOCKING_SEVERITY[finding.severity],
  };
}

export function classifyDiagnosticFindings(findings: DiagnosticFinding[]) {
  return findings.map(classifyDiagnosticFinding);
}

export function isHardDiagnostic(finding: DiagnosticFinding) {
  return classifyDiagnosticFinding(finding).blockingSeverity === "hard";
}

export function groupDiagnosticFindings(findings: DiagnosticFinding[]): GroupedDiagnostics {
  const classifiedFindings = classifyDiagnosticFindings(findings);
  const dedupe = (rows: DiagnosticFinding[]) => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.scope}:${row.severity}:${row.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const blockers = dedupe(classifiedFindings.filter((finding) => finding.blockingSeverity === "hard"));
  const softFindings = classifiedFindings.filter((finding) => finding.blockingSeverity === "soft");
  const actionableWarnings = dedupe(softFindings.filter((finding) => finding.scope === "slice" || finding.scope === "parent"));
  const projectDebtWarnings = dedupe(softFindings.filter((finding) => finding.scope === "project"));
  const historicalWarnings = dedupe(softFindings.filter((finding) => finding.scope === "history"));

  return {
    blockers,
    actionableWarnings,
    projectDebtWarnings,
    historicalWarnings,
    counts: {
      blockers: blockers.length,
      actionableWarnings: actionableWarnings.length,
      projectDebtWarnings: projectDebtWarnings.length,
      historicalWarnings: historicalWarnings.length,
    },
  };
}
