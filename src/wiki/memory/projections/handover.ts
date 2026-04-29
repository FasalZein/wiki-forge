export type HandoverRecovery = {
  readonly command: string;
  readonly reason: string;
};

export type HandoverProjection = {
  readonly kind: "handover-projection";
  readonly project: string;
  readonly targetSliceId: string;
  readonly canonicalActiveSliceId: string | null;
  readonly phase: string;
  readonly runState: string;
  readonly blockers: readonly string[];
  readonly nextCommand: string;
  readonly recovery: readonly HandoverRecovery[];
};

export type BuildHandoverProjectionInput = {
  readonly project: string;
  readonly targetSliceId: string;
  readonly canonicalActiveSliceId: string | null;
  readonly phase: string;
  readonly runState: string;
  readonly blockers: readonly string[];
  readonly nextCommand: string;
};

export function buildHandoverProjection(input: BuildHandoverProjectionInput): HandoverProjection {
  return {
    kind: "handover-projection",
    project: input.project,
    targetSliceId: input.targetSliceId,
    canonicalActiveSliceId: input.canonicalActiveSliceId,
    phase: input.phase,
    runState: input.runState,
    blockers: input.blockers,
    nextCommand: input.nextCommand,
    recovery: buildRecovery(input),
  };
}

function buildRecovery(input: BuildHandoverProjectionInput): readonly HandoverRecovery[] {
  if (!input.canonicalActiveSliceId || input.canonicalActiveSliceId === input.targetSliceId) return [];
  return [{
    command: `wiki forge status ${input.project} ${input.canonicalActiveSliceId} --repo . --json`,
    reason: `handover target ${input.targetSliceId} disagrees with canonical active slice ${input.canonicalActiveSliceId}`,
  }];
}
