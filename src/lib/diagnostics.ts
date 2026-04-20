export type DiagnosticScope = "slice" | "parent" | "project" | "history";
export type DiagnosticSeverity = "blocker" | "warning";

export type DiagnosticFinding = {
  scope: DiagnosticScope;
  severity: DiagnosticSeverity;
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

export function groupDiagnosticFindings(findings: DiagnosticFinding[]): GroupedDiagnostics {
  const dedupe = (rows: DiagnosticFinding[]) => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.scope}:${row.severity}:${row.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const blockers = dedupe(findings.filter((finding) => finding.severity === "blocker"));
  const actionableWarnings = dedupe(findings.filter((finding) => finding.severity === "warning" && (finding.scope === "slice" || finding.scope === "parent")));
  const projectDebtWarnings = dedupe(findings.filter((finding) => finding.severity === "warning" && finding.scope === "project"));
  const historicalWarnings = dedupe(findings.filter((finding) => finding.severity === "warning" && finding.scope === "history"));

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
