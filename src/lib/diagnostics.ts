export type DiagnosticScope = "slice" | "parent" | "project" | "history";
export type DiagnosticSeverity = "blocker" | "warning";

export type DiagnosticFinding = {
  scope: DiagnosticScope;
  severity: DiagnosticSeverity;
  message: string;
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
