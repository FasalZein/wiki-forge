export type ActiveSliceClaim = {
  readonly project: string;
  readonly sliceId: string;
  readonly claimedBy?: string;
  readonly claimedAt?: string;
};

export type ForgeSliceLifecycleStatus = "draft" | "ready" | "in-progress" | "done" | "cancelled";

export type ForgeProjectState = {
  readonly project: string;
  readonly activeSlices: readonly ActiveSliceClaim[];
  readonly sliceStatuses?: Readonly<Record<string, ForgeSliceLifecycleStatus>>;
};
