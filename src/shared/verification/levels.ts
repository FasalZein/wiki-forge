export const VERIFICATION_LEVELS = ["scaffold", "inferred", "code-verified", "runtime-verified", "test-verified"] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number] | "stale";
export const TEST_VERIFIED_LEVEL = "test-verified" satisfies VerificationLevel;
