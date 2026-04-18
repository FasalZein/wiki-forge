export type HierarchyStatus = "not-started" | "in-progress" | "needs-verification" | "complete";

// A slice state combines its backlog status and verification level
export type SliceState = {
  taskId: string;
  status: string | null; // "draft", "in-progress", "done", "cancelled"
  verificationLevel: string | null; // from VERIFICATION_LEVELS
};

/**
 * Compute the aggregate status of a feature or PRD from its child slice states.
 *
 * Rules:
 * - Cancelled slices are excluded from the denominator
 * - complete       = all non-cancelled are done AND have test-verified level
 * - needs-verification = all non-cancelled are done but some are not test-verified
 * - in-progress    = at least one slice is not draft but not all are done
 * - not-started    = no slices, or all are draft (or all cancelled)
 *
 * When no active child slices exist, the authored `status:` on the entity's
 * own frontmatter is honored (`complete` / `in-progress`). This covers PRDs
 * and features implemented directly without a slicing pass.
 */
export function computeStatus(sliceStates: SliceState[], authoredStatus?: string | null): HierarchyStatus {
  const active = sliceStates.filter((s) => s.status !== "cancelled");

  // Authored-status fallback applies ONLY when there are no slices at all
  // (PRDs/features implemented directly). If slices exist but all are
  // cancelled, that's genuine drift — return "not-started" so R3 cascade can heal.
  if (sliceStates.length === 0) {
    if (authoredStatus === "complete") return "complete";
    if (authoredStatus === "in-progress") return "in-progress";
    return "not-started";
  }

  if (active.length === 0) return "not-started";

  const allDraft = active.every((s) => !s.status || s.status === "draft");
  if (allDraft) return "not-started";

  const allDone = active.every((s) => s.status === "done");
  if (allDone) {
    const allTestVerified = active.every((s) => s.verificationLevel === "test-verified");
    return allTestVerified ? "complete" : "needs-verification";
  }

  return "in-progress";
}
