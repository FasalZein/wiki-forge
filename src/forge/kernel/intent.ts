import type { KernelJsonValue } from "./changeset";

export const LIFECYCLE_PHASES = [
  "research",
  "grill-with-docs",
  "prd",
  "slices",
  "start",
  "implementation",
  "tdd",
  "verify",
  "desloppify",
  "review",
  "closeout",
  "gate",
  "amend",
] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const KERNEL_INTENT_TYPES = [
  "forge-start",
  "complete-phase",
  "record-evidence",
  "forge-verify",
  "request-review",
  "forge-close",
  "amend-slice",
  "generate-projection",
] as const;
export type KernelIntentType = (typeof KERNEL_INTENT_TYPES)[number];

export type KernelActor = {
  readonly kind: "agent" | "user" | "system";
  readonly id: string;
  readonly displayName?: string;
};

export type KernelIntentContext = {
  readonly project: string;
  readonly requestedAt: string;
  readonly sliceId?: string;
  readonly prdId?: string;
  readonly featureId?: string;
  readonly repo?: string;
  readonly baseRevision?: string;
};

type KernelIntentBase<TType extends KernelIntentType, TPayload extends KernelIntentPayload> = {
  readonly kind: "intent";
  readonly id: string;
  readonly type: TType;
  readonly actor: KernelActor;
  readonly context: KernelIntentContext;
  readonly payload: TPayload;
};

export type KernelIntentPayload = { readonly [key: string]: KernelJsonValue };

export type StartSliceIntent = KernelIntentBase<"forge-start", {
  readonly sliceId: string;
  readonly agent: string;
  readonly takeoverReason?: string;
}>;

export type CompletePhaseIntent = KernelIntentBase<"complete-phase", {
  readonly phase: LifecyclePhase;
  readonly evidenceRef?: string;
  readonly skipReason?: string;
}>;

export type RecordEvidenceIntent = KernelIntentBase<"record-evidence", {
  readonly phase: "tdd" | "verify" | "review" | "gate";
  readonly evidenceKind: string;
  readonly evidenceRef: string;
}>;

export type VerifySliceIntent = KernelIntentBase<"forge-verify", {
  readonly sliceId: string;
  readonly commands: readonly string[];
}>;

export type RequestReviewIntent = KernelIntentBase<"request-review", {
  readonly sliceId: string;
  readonly reviewer: string;
}>;

export type CloseSliceIntent = KernelIntentBase<"forge-close", {
  readonly sliceId: string;
  readonly closedBy: string;
}>;

export type AmendSliceIntent = KernelIntentBase<"amend-slice", {
  readonly closedSliceId: string;
  readonly reason: string;
}>;

export type GenerateProjectionIntent = KernelIntentBase<"generate-projection", {
  readonly projection: "backlog" | "status" | "resume" | "handover" | "index";
  readonly targetPath?: string;
}>;

export type KernelIntent =
  | StartSliceIntent
  | CompletePhaseIntent
  | RecordEvidenceIntent
  | VerifySliceIntent
  | RequestReviewIntent
  | CloseSliceIntent
  | AmendSliceIntent
  | GenerateProjectionIntent;

export type Intent = KernelIntent;
