import type { AcceptedChangeSet } from "./changeset";
import type { KernelIntent } from "./intent";
import type { KernelRejection } from "./rejection";

export type AcceptedKernelResult = {
  readonly status: "accepted";
  readonly intent: KernelIntent;
  readonly changeset: AcceptedChangeSet;
  readonly rejection?: never;
};

export type RejectedKernelResult = {
  readonly status: "rejected";
  readonly intent: KernelIntent;
  readonly rejection: KernelRejection;
  readonly changeset?: never;
};

export type KernelResult = AcceptedKernelResult | RejectedKernelResult;

export function acceptKernelIntent(intent: KernelIntent, changeset: AcceptedChangeSet): AcceptedKernelResult {
  return {
    status: "accepted",
    intent,
    changeset,
  };
}

export function rejectKernelIntent(intent: KernelIntent, rejection: KernelRejection): RejectedKernelResult {
  return {
    status: "rejected",
    intent,
    rejection,
  };
}

export function isAcceptedKernelResult(result: KernelResult): result is AcceptedKernelResult {
  return result.status === "accepted";
}

export function isRejectedKernelResult(result: KernelResult): result is RejectedKernelResult {
  return result.status === "rejected";
}
