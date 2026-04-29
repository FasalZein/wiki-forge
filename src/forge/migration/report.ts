import { classifyLegacyDocument } from "../vault/legacy-classifier";
import type { LegacyClassification } from "../vault/legacy-classifier";
import type { ForgeDiagnostic, VaultDocument } from "../vault/document";

export type MigrationIssue = {
  readonly path: string;
  readonly status: "repairable" | "quarantined";
  readonly diagnostics: readonly string[];
};

export type MigrationReport = {
  readonly project: string;
  readonly summary: {
    readonly valid: number;
    readonly repairable: number;
    readonly quarantined: number;
    readonly projection: number;
  };
  readonly issues: readonly MigrationIssue[];
  readonly preserveSourceFiles: true;
  readonly writes: readonly [];
};

export type BuildMigrationReportInput = {
  readonly project: string;
  readonly documents: readonly VaultDocument[];
};

export function buildMigrationReport(input: BuildMigrationReportInput): MigrationReport {
  const summary = { valid: 0, repairable: 0, quarantined: 0, projection: 0 };
  const issues: MigrationIssue[] = [];

  for (const document of input.documents) {
    const classification = classifyLegacyDocument(document);
    summary[classification.status] += 1;
    if (classification.status === "repairable" || classification.status === "quarantined") {
      issues.push({
        path: document.path,
        status: classification.status,
        diagnostics: diagnosticsToStrings(classification.diagnostics),
      });
    }
  }

  return {
    project: input.project,
    summary,
    issues,
    preserveSourceFiles: true,
    writes: [],
  };
}

export function diagnosticsToStrings(diagnostics: readonly ForgeDiagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
}

export function isImportableClassification(classification: LegacyClassification): boolean {
  return classification.status === "valid" || classification.status === "projection" || classification.status === "repairable";
}
