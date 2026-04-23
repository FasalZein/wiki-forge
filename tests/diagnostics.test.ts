import { describe, expect, test } from "bun:test";
import { DIAGNOSTIC_BLOCKING_SEVERITY, classifyDiagnosticFinding, formatMaintenanceActionLabel, groupDiagnosticFindings } from "../src/maintenance/shared";

describe("diagnostics", () => {
  test("formatMaintenanceActionLabel includes scope when present", () => {
    expect(formatMaintenanceActionLabel({ kind: "add-tests", scope: "slice" })).toBe("[slice][add-tests]");
  });

  test("formatMaintenanceActionLabel omits scope when absent", () => {
    expect(formatMaintenanceActionLabel({ kind: "review-page" })).toBe("[review-page]");
  });

  test("formatMaintenanceActionLabel handles all scope values", () => {
    expect(formatMaintenanceActionLabel({ kind: "fix", scope: "parent" })).toBe("[parent][fix]");
    expect(formatMaintenanceActionLabel({ kind: "fix", scope: "project" })).toBe("[project][fix]");
    expect(formatMaintenanceActionLabel({ kind: "fix", scope: "history" })).toBe("[history][fix]");
  });

  test("classifies diagnostics into hard blockers and soft advisory warnings", () => {
    expect(DIAGNOSTIC_BLOCKING_SEVERITY).toEqual({ blocker: "hard", warning: "soft" });
    expect(classifyDiagnosticFinding({ scope: "slice", severity: "blocker", message: "missing tests" }).blockingSeverity).toBe("hard");
    expect(classifyDiagnosticFinding({ scope: "project", severity: "warning", message: "project debt" }).blockingSeverity).toBe("soft");

    const grouped = groupDiagnosticFindings([
      { scope: "slice", severity: "blocker", message: "missing tests" },
      { scope: "project", severity: "warning", message: "project debt" },
    ]);
    expect(grouped.blockers[0]?.blockingSeverity).toBe("hard");
    expect(grouped.projectDebtWarnings[0]?.blockingSeverity).toBe("soft");
  });
});
