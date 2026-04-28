import type { KernelRejection } from "../kernel/rejection";

export function renderKernelRejectionText(rejection: KernelRejection): string {
  const nextRecovery = rejection.recovery[0]?.command;
  return [
    `rejected ${rejection.code}: ${rejection.invariant}`,
    ...(nextRecovery ? [`next: ${nextRecovery}`] : []),
  ].join("\n");
}

export function renderKernelRejectionJson(rejection: KernelRejection): string {
  return JSON.stringify(rejection);
}
