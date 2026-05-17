import type { ForgeEvidenceRecord, TddEvidenceRecord } from "./evidence";

export type TddGateStatus = "missing-red" | "missing-green" | "invalid-sequence" | "passed";

export type TddRecovery = {
  readonly command: string;
  readonly description: string;
};

export type TddGate =
  | { readonly status: "missing-red"; readonly recovery: TddRecovery }
  | { readonly status: "missing-green"; readonly red: TddEvidenceRecord; readonly recovery: TddRecovery }
  | { readonly status: "invalid-sequence"; readonly reason: string; readonly recovery: TddRecovery }
  | { readonly status: "passed"; readonly red: TddEvidenceRecord; readonly green: TddEvidenceRecord };

export function evaluateTddGate(
  evidence: readonly ForgeEvidenceRecord[],
  context?: { readonly project?: string; readonly sliceId?: string },
): TddGate {
  const strictRecords = evidence.filter(isStrictTddEvidence).sort(compareRecordedAt);
  const redRecords = strictRecords.filter((record) => record.phase === "red" && record.result === "failed");
  const greenRecords = strictRecords.filter((record) => record.phase === "green" && record.result === "passed");

  let invalidReason: string | null = null;
  let latestRed: TddEvidenceRecord | null = null;
  let latestGreen: TddEvidenceRecord | null = null;

  for (const red of redRecords) {
    latestRed = red;
    for (const green of greenRecords) {
      latestGreen = green;
      if (compareRecordedAt(red, green) >= 0) continue;
      if (!isSameTddTarget(red, green)) {
        invalidReason = "green TDD evidence must use the same command as the red evidence, or be recorded in the same TDD cycle";
        continue;
      }
      if (!hasSharedTestPath(red, green)) {
        invalidReason = "green TDD evidence must share at least one test path with the red evidence";
        continue;
      }
      return { status: "passed", red, green };
    }
  }

  if (!latestRed) return { status: "missing-red", recovery: redRecovery(context) };
  if (!latestGreen) return { status: "missing-green", red: latestRed, recovery: greenRecovery(latestRed, context) };
  return {
    status: "invalid-sequence",
    reason: invalidReason ?? "TDD red/green records do not form a valid sequence",
    recovery: greenRecovery(latestRed, context),
  };
}

export function hasPassedTddEvidence(evidence: readonly ForgeEvidenceRecord[]): boolean {
  return evaluateTddGate(evidence).status === "passed";
}

export function isStrictTddEvidence(record: ForgeEvidenceRecord): record is TddEvidenceRecord {
  if (record.kind !== "tdd" || !("phase" in record) || !("testPaths" in record)) return false;
  return (record.phase === "red" || record.phase === "green")
    && ((record.phase === "red" && record.result === "failed") || (record.phase === "green" && record.result === "passed"))
    && record.command.trim().length > 0
    && record.testPaths.length > 0;
}

function hasSharedTestPath(red: TddEvidenceRecord, green: TddEvidenceRecord) {
  const redPaths = new Set(red.testPaths.map(normalizeTestPath));
  return green.testPaths.map(normalizeTestPath).some((path) => redPaths.has(path));
}

function normalizeTestPath(path: string) {
  return path.replaceAll("\\", "/").trim();
}

function compareRecordedAt(left: TddEvidenceRecord, right: TddEvidenceRecord) {
  return left.recordedAt.localeCompare(right.recordedAt);
}

function redRecovery(context?: { readonly project?: string; readonly sliceId?: string }): TddRecovery {
  return {
    command: `${commandPrefix("cycle", context)} --test <path> --red-command "<failing test command>" --green-command "<passing test command>"`,
    description: "Record the failing red step and later passing green step as one TDD cycle."
  };
}

function greenRecovery(red: TddEvidenceRecord, context?: { readonly project?: string; readonly sliceId?: string }): TddRecovery {
  const test = normalizeTestPath(red.testPaths[0] ?? "<same-path>");
  return {
    command: `${commandPrefix("green", context)} --test ${test} --command ${JSON.stringify(red.command)}`,
    description: "Record the passing green step using the same command, or use tdd cycle when the passing command differs but targets the same test."
  };
}

function isSameTddTarget(red: TddEvidenceRecord, green: TddEvidenceRecord) {
  if (red.command === green.command) return true;
  return Boolean(red.cycleId && red.cycleId === green.cycleId);
}

function commandPrefix(action: "red" | "green" | "cycle", context?: { readonly project?: string; readonly sliceId?: string }) {
  if (context?.project && context.sliceId) return `wiki forge tdd ${action} ${context.project} ${context.sliceId}`;
  return `wiki forge tdd ${action} <project> <slice-id>`;
}
