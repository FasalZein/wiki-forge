import { orderFrontmatter } from "../../cli-shared";
import type { PlanningSession } from "./planning-types";

export type PlanningSessionGateSummary = {
  readonly missing: readonly string[];
};

export function renderPlanningSessionBody(session: PlanningSession, gate: PlanningSessionGateSummary): string {
  return [
    `# Planning Session — ${session.featureName}`,
    "",
    "> [!summary]",
    "> Forge Forge planning-session state. This is lifecycle input, not a legacy backlog projection.",
    "",
    "## Gate",
    "",
    `- Status: ${session.status}`,
    `- Missing: ${gate.missing.length ? gate.missing.join(", ") : "none"}`,
    "",
    "## Required Sequence",
    "",
    "1. Torpathy framing",
    "2. Domain-model questions and decision capture",
    "3. One grill session per PRD candidate",
    "4. PRD creation",
    "5. PRD-to-slices",
    "",
    "## PRD Candidates",
    "",
    ...session.prds.flatMap((prd) => [`- ${prd.name}`, ...prd.slices.map((slice) => `  - Slice: ${slice}`)]),
  ].join("\n");
}

export function orderForgeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  return orderFrontmatter(data, [
    "title", "type", "project", "feature_name", "session_id", "feature_id", "prd_id", "task_id",
    "parent_feature", "parent_prd", "planning_session", "status", "created_at", "updated", "answers", "prds", "artifacts", "review_policy",
  ]);
}
