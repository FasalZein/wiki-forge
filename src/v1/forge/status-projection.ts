import type { KernelRejection } from "../kernel/rejection";
import type { LegacyClassification } from "../vault/legacy-classifier";
import type { V1RecordStatus } from "../vault/document";

export type V1SliceProjectionRecord = {
  readonly project: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: V1RecordStatus;
};

export type ForgeNextProjection =
  | {
    readonly status: "active";
    readonly project: string;
    readonly activeSliceId: string;
    readonly nextAction: "continue-active-slice";
    readonly source: "canonical-records";
  }
  | {
    readonly status: "ready";
    readonly project: string;
    readonly nextSliceId: string;
    readonly nextAction: "start-ready-slice";
    readonly source: "canonical-records";
  }
  | {
    readonly status: "empty";
    readonly project: string;
    readonly nextAction: "plan-next-slice";
    readonly source: "canonical-records";
  }
  | {
    readonly status: "conflict";
    readonly project: string;
    readonly rejection: KernelRejection;
    readonly source: "canonical-records";
  }
  | {
    readonly status: "needs-repair";
    readonly project: string;
    readonly diagnostics: readonly string[];
    readonly source: "canonical-records";
  };

export type ForgeNextInput = {
  readonly project: string;
  readonly slices: readonly V1SliceProjectionRecord[];
  readonly legacyClassifications?: readonly LegacyClassification[];
  readonly generatedProjectionActiveSliceId?: string;
};

export function collectLegacyDiagnostics(classifications: readonly LegacyClassification[] = []): readonly string[] {
  return classifications.flatMap((classification) => {
    if (classification.status !== "repairable" && classification.status !== "quarantined") return [];
    return classification.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  });
}
