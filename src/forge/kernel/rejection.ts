import type { ChangeAffectedFile, ChangeTargetRecord, KernelJsonValue } from "./changeset";
import type { LifecyclePhase } from "./intent";

export const KERNEL_REJECTION_CODES = [
  "AnotherSliceActive",
  "MultipleActiveSlices",
  "MissingTddEvidence",
  "MissingVerificationEvidence",
  "ReviewGateMissing",
  "GateFailed",
  "ConcurrentModification",
  "ProjectionStaleButCanonicalValid",
] as const;
export type KernelRejectionCode = (typeof KERNEL_REJECTION_CODES)[number];

export const KERNEL_INVARIANTS = [
  "single-active-slice",
  "required-phase-order",
  "required-evidence-before-close",
  "review-before-close",
  "gate-before-release",
  "optimistic-concurrency",
  "canonical-state-over-projection",
] as const;
export type KernelInvariantName = (typeof KERNEL_INVARIANTS)[number];

export type RecoveryHint = {
  readonly command: string;
  readonly description: string;
  readonly phase?: LifecyclePhase;
  readonly safeToRetry?: boolean;
};

export type KernelRejectionAffected = {
  readonly records: readonly ChangeTargetRecord[];
  readonly files: readonly ChangeAffectedFile[];
};

export type KernelRejection = {
  readonly kind: "kernel-rejection";
  readonly code: KernelRejectionCode;
  readonly reason: string;
  readonly invariant: KernelInvariantName;
  readonly affected: KernelRejectionAffected;
  readonly recovery: readonly RecoveryHint[];
  readonly metadata?: { readonly [key: string]: KernelJsonValue };
};

export type CreateKernelRejectionInput = Omit<KernelRejection, "kind">;

export function createKernelRejection(input: CreateKernelRejectionInput): KernelRejection {
  return {
    kind: "kernel-rejection",
    code: input.code,
    reason: input.reason,
    invariant: input.invariant,
    affected: input.affected,
    recovery: input.recovery,
    metadata: input.metadata,
  };
}

export function getKernelRejectionRecoveryCommands(rejection: KernelRejection): readonly string[] {
  return rejection.recovery.map((hint) => hint.command);
}
