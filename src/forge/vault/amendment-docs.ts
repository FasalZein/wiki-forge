import { orderFrontmatter, writeNormalizedPage } from "../../cli-shared";
import type { ForgeSliceDocumentPaths } from "./forge-artifacts";

export type WriteAmendmentDocsInput = {
  readonly project: string;
  readonly closedSliceId: string;
  readonly amendmentSliceId: string;
  readonly title: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly sourcePaths: readonly string[];
  readonly parentPrd: string | null;
  readonly parentFeature: string | null;
  readonly paths: ForgeSliceDocumentPaths;
};

export function writeAmendmentDocs(input: WriteAmendmentDocsInput): void {
  const hubLink = sliceDocVaultLink(input.project, input.amendmentSliceId, "index");
  const planLink = sliceDocVaultLink(input.project, input.amendmentSliceId, "plan");
  const testPlanLink = sliceDocVaultLink(input.project, input.amendmentSliceId, "test-plan");
  const closedLink = sliceDocVaultLink(input.project, input.closedSliceId, "index");
  const baseFrontmatter = {
    title: `${input.amendmentSliceId} ${input.title}`,
    type: "forge-slice",
    project: input.project,
    source_paths: input.sourcePaths,
    task_id: input.amendmentSliceId,
    depends_on: [input.closedSliceId],
    amendment_of: input.closedSliceId,
    amendment_reason: input.reason,
    amendment_created_at: input.createdAt,
    ...(input.parentPrd ? { parent_prd: input.parentPrd } : {}),
    ...(input.parentFeature ? { parent_feature: input.parentFeature } : {}),
    created_at: input.createdAt,
    updated: input.createdAt,
    status: "draft",
  };

  writeNormalizedPage(input.paths.indexPath, [
    `# ${input.amendmentSliceId} — ${input.title}`,
    "",
    "> [!summary]",
    `> Forge amendment slice for ${input.closedSliceId}. The closed slice remains immutable; this slice carries follow-up work.`,
    "",
    "## Amendment",
    "",
    `- Amends closed slice: [[${closedLink}|${input.closedSliceId}]]`,
    `- Reason: ${input.reason}`,
    "- Do not reopen or edit the closed slice; this amendment carries the follow-up work.",
    "",
    "## Documents",
    "",
    `- [[${planLink}]]`,
    `- [[${testPlanLink}]]`,
    "",
    "## Cross Links",
    "",
    `- [[projects/${input.project}/forge/slices/${input.amendmentSliceId}/index]]`,
  ].join("\n"), orderForgeSliceFrontmatter({ ...baseFrontmatter, review_policy: { required_approvals: 1 } }));

  writeNormalizedPage(input.paths.planPath, [
    `# ${input.amendmentSliceId} ${input.title}`,
    "",
    "> [!summary]",
    `> Execution plan for Forge amendment ${input.amendmentSliceId}.`,
    "",
    "## Amendment Context",
    "",
    `- Closed slice: [[${closedLink}|${input.closedSliceId}]]`,
    `- Reason: ${input.reason}`,
    "- Preserve the original close evidence; scope only the follow-up change here.",
    "",
    "## Scope",
    "",
    "- ",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] ",
    "",
    "## Cross Links",
    "",
    `- [[${hubLink}]]`,
    `- [[${testPlanLink}]]`,
  ].join("\n"), orderForgeSliceFrontmatter({ ...baseFrontmatter, type: "forge-slice-plan" }));

  writeNormalizedPage(input.paths.testPlanPath, [
    `# ${input.amendmentSliceId} ${input.title}`,
    "",
    "> [!summary]",
    `> Regression checklist for Forge amendment ${input.amendmentSliceId}.`,
    "",
    "## Amendment Verification Context",
    "",
    `- Closed slice: [[${closedLink}|${input.closedSliceId}]]`,
    `- Reason: ${input.reason}`,
    "- Add regression coverage that proves the amended behavior without mutating prior close evidence.",
    "",
    "## Red Tests",
    "",
    "- [ ] ",
    "",
    "## Green Criteria",
    "",
    "- [ ] ",
    "",
    "## Verification Commands",
    "",
    "```bash",
    "# add one or more repo-root commands that prove this amendment is done",
    "```",
    "",
    "## Cross Links",
    "",
    `- [[${hubLink}]]`,
    `- [[${planLink}]]`,
  ].join("\n"), orderForgeSliceFrontmatter({ ...baseFrontmatter, type: "forge-slice-test-plan" }));
}

function orderForgeSliceFrontmatter(data: Record<string, unknown>) {
  return orderFrontmatter(data, [
    "title", "type", "project", "source_paths", "task_id",
    "depends_on", "amendment_of", "amendment_reason", "amendment_created_at",
    "parent_prd", "parent_feature", "created_at", "updated", "status", "review_policy",
    "claimed_by", "claimed_at",
  ]);
}

function sliceDocVaultLink(project: string, sliceId: string, kind: "index" | "plan" | "test-plan"): string {
  return `projects/${project}/forge/slices/${sliceId}/${kind}`;
}
