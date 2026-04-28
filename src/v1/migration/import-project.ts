import { classifyLegacyDocument } from "../vault/legacy-classifier";
import type { VaultDocument } from "../vault/document";

export type ImportWritePlan = {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly recordKind: "project" | "slice";
};

export type ProjectImportPlan =
  | {
    readonly status: "planned";
    readonly preserveSourceFiles: true;
    readonly writes: readonly ImportWritePlan[];
  }
  | {
    readonly status: "refused";
    readonly reason: string;
    readonly quarantinedPaths: readonly string[];
    readonly preserveSourceFiles: true;
    readonly writes: readonly [];
  };

export type PlanProjectImportInput = {
  readonly project: string;
  readonly targetRoot: string;
  readonly documents: readonly VaultDocument[];
};

export function planProjectImport(input: PlanProjectImportInput): ProjectImportPlan {
  const writes: ImportWritePlan[] = [];
  const quarantinedPaths: string[] = [];

  for (const document of input.documents) {
    const classification = classifyLegacyDocument(document);
    if (classification.status === "quarantined") {
      quarantinedPaths.push(document.path);
      continue;
    }
    if (classification.status !== "valid") continue;
    const targetPath = classification.record.kind === "slice"
      ? `${input.targetRoot}/slices/${classification.record.taskId}.json`
      : `${input.targetRoot}/project.json`;
    writes.push({
      sourcePath: document.path,
      targetPath,
      recordKind: classification.record.kind,
    });
  }

  if (quarantinedPaths.length > 0) {
    return {
      status: "refused",
      reason: "quarantined lifecycle records cannot participate in V1 import",
      quarantinedPaths,
      preserveSourceFiles: true,
      writes: [],
    };
  }

  return {
    status: "planned",
    preserveSourceFiles: true,
    writes,
  };
}
