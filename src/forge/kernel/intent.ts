import type { KernelJsonValue } from "./changeset";

export const KERNEL_INTENT_TYPES = [
  "forge-start",
  "forge-close",
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

export type KernelIntentPayload = { readonly [key: string]: KernelJsonValue };

type KernelIntentBase<TType extends KernelIntentType, TPayload extends KernelIntentPayload> = {
  readonly kind: "intent";
  readonly id: string;
  readonly type: TType;
  readonly actor: KernelActor;
  readonly context: KernelIntentContext;
  readonly payload: TPayload;
};

export type StartSliceIntent = KernelIntentBase<"forge-start", {
  readonly sliceId: string;
  readonly agent: string;
  readonly takeoverReason?: string;
}>;

export type CloseSliceIntent = KernelIntentBase<"forge-close", {
  readonly sliceId: string;
  readonly closedBy: string;
}>;

export type KernelIntent = StartSliceIntent | CloseSliceIntent;

export type Intent = KernelIntent;
