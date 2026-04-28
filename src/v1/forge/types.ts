export type ActiveSliceClaim = {
  readonly project: string;
  readonly sliceId: string;
  readonly claimedBy?: string;
  readonly claimedAt?: string;
};

export type ForgeProjectState = {
  readonly project: string;
  readonly activeSlices: readonly ActiveSliceClaim[];
};
