import type { PlanningPrdCandidate, PlanningSession } from "./planning-session-store";

export function renderFeatureBody(session: PlanningSession): string {
  return [
    `# ${session.featureName}`,
    "",
    "> [!summary]",
    "> Created from a completed Forge Forge planning session.",
    "",
    "## Planning Session",
    "",
    `- Session: [[projects/${session.project}/forge/sessions/${session.sessionId}]]`,
    "",
    "## User Outcome",
    "",
    `- Deliver the planned ${session.featureName} outcome through the PRD(s) below.`,
    "",
    "## PRDs",
    "",
    ...session.prds.map((prd) => `- ${prd.name}`),
    "",
    "## Decisions",
    "",
    ...planningDecisionLines(session),
    "",
    "## Handover Hints",
    "",
    "- Use `wiki forge status` for lifecycle truth.",
    "- Keep follow-up scope in Forge Forge artifacts, not legacy specs/backlog files.",
  ].join("\n");
}

export function renderPrdBody(session: PlanningSession, prd: PlanningPrdCandidate): string {
  const grillAnswers = session.answers.filter((answer) => answer.skill === "grill-me" && answer.prdName === prd.name);
  return [
    `# ${prd.name}`,
    "",
    "## Problem",
    "",
    "Captured from the completed Forge planning session.",
    "",
    "## Domain Terms",
    "",
    ...planningDecisionLines(session),
    "",
    "## Goals",
    "",
    ...prd.slices.map((slice) => `- Enable: ${slice}`),
    "",
    "## Non-Goals",
    "",
    "- Anything not resolved by the planning session remains out of scope.",
    "",
    "## Users / Actors",
    "",
    "- Agents and maintainers using Forge lifecycle commands.",
    "",
    "## User Stories",
    "",
    ...prd.slices.map((slice, index) => `${index + 1}. As an agent, I want ${slice}, so that implementation work starts from a verified plan.`),
    "",
    "## Acceptance Criteria",
    "",
    ...prd.slices.map((slice) => `- [ ] ${slice}`),
    "",
    "## Prior Research",
    "",
    `- [[projects/${session.project}/forge/sessions/${session.sessionId}]]`,
    "",
    "## Open Questions",
    "",
    "- None for this PRD session.",
    "",
    "## Implementation Decisions",
    "",
    ...planningDecisionLines(session),
    "",
    "## Grill Session",
    "",
    ...(grillAnswers.length ? grillAnswers.map((answer) => `- ${answer.response}`) : ["- Completed; see planning session."]),
    "",
    "## Handover Hints",
    "",
    "- Start slices with `wiki forge start` or `wiki forge run`.",
    "- Close slices only after TDD, targeted verification, and required review evidence are recorded.",
  ].join("\n");
}

export function renderSliceHubBody(input: { project: string; sliceId: string; title: string }): string {
  return [
    `# ${input.sliceId} — ${input.title}`,
    "",
    "> [!summary]",
    "> Forge planned slice created from an approved PRD planning session.",
    "",
    "## User Job",
    "",
    `- ${input.title}`,
    "",
    "## Scope",
    "",
    `- Implement only the narrow behavior needed for: ${input.title}`,
    "",
    "## Handover Hints",
    "",
    `- Status truth: \`wiki forge status ${input.project} ${input.sliceId} --json\``,
    "- Record TDD and targeted verification evidence before close.",
  ].join("\n");
}

export function renderSlicePlanBody(input: { title: string; sliceId: string }): string {
  return [
    `# ${input.sliceId} ${input.title}`,
    "",
    "## Scope",
    "",
    `- ${input.title}`,
    "",
    "## TDD Plan",
    "",
    `- Write the smallest failing test that proves: ${input.title}`,
    "- Implement the minimal production code needed to pass it.",
    "- Refactor only after the behavior is green.",
    "",
    "## Acceptance Criteria",
    "",
    `- [ ] ${input.title}`,
    "",
    "## Verification Expectations",
    "",
    "- Targeted verification must exercise the changed behavior, not only the full suite.",
  ].join("\n");
}

export function renderSliceTestPlanBody(input: { title: string; sliceId: string }): string {
  return [
    `# ${input.sliceId} ${input.title}`,
    "",
    "## Red Tests",
    "",
    `- [ ] Add a failing test for: ${input.title}`,
    "",
    "## Targeted Verification",
    "",
    `- [ ] Run the narrowest command that proves ${input.sliceId} is complete.`,
    "",
    "## Verification Commands",
    "",
    "```bash",
    "bun test",
    "```",
  ].join("\n");
}

function planningDecisionLines(session: PlanningSession): string[] {
  const decisions = session.answers.filter((answer) => answer.skill !== "grill-me");
  if (!decisions.length) return ["- See the planning session for captured decisions."];
  return decisions.map((answer) => `- ${answer.skill}: ${answer.response}`);
}
