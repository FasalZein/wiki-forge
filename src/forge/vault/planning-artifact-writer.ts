import { mkdir } from "node:fs/promises";
import { writeNormalizedPage } from "../../cli-shared";
import { absoluteVaultPath, currentMaxSequenceNumber, forgeArtifactDirectory, forgeArtifactPath, forgeArtifactSlug, forgeSequenceId, forgeSliceDocumentPaths, nextForgeSequenceId } from "./forge-artifacts";
import { renderFeatureBody, renderPrdBody, renderSliceHubBody, renderSlicePlanBody, renderSliceTestPlanBody } from "./planning-artifact-templates";
import { orderForgeFrontmatter } from "./planning-session-rendering";
import type { PlanningArtifacts, PlanningSession } from "./planning-types";

export type WritePlanningArtifactsInput = {
  readonly vaultRoot: string;
  readonly project: string;
  readonly featureName: string;
  readonly session: PlanningSession;
  readonly now: string;
};

export async function writePlanningArtifacts(input: WritePlanningArtifactsInput): Promise<PlanningArtifacts> {
  const featureId = await nextForgeSequenceId(input.vaultRoot, input.project, "feature");
  const featureSlug = forgeArtifactSlug(input.featureName);
  const featurePath = absoluteVaultPath(input.vaultRoot, forgeArtifactPath(input.project, "feature", featureId, featureSlug));
  await mkdir(absoluteVaultPath(input.vaultRoot, forgeArtifactDirectory(input.project, "feature")), { recursive: true });
  writeNormalizedPage(featurePath, renderFeatureBody(input.session), orderForgeFrontmatter({
    title: input.featureName,
    type: "forge-feature",
    project: input.project,
    feature_id: featureId,
    status: "draft",
    created_at: input.now,
    updated: input.now,
    planning_session: input.session.sessionId,
  }));

  const prdArtifacts: {
    prdId: string;
    name: string;
    slices: string[];
  }[] = [];
  let prdCounter = await currentMaxSequenceNumber(input.vaultRoot, input.project, "prd");
  let sliceCounter = await currentMaxSequenceNumber(input.vaultRoot, input.project, "slice");
  await mkdir(absoluteVaultPath(input.vaultRoot, forgeArtifactDirectory(input.project, "prd")), { recursive: true });
  for (const candidate of input.session.prds) {
    prdCounter += 1;
    const prdId = `PRD-${String(prdCounter).padStart(3, "0")}`;
    const prdPath = absoluteVaultPath(input.vaultRoot, forgeArtifactPath(input.project, "prd", prdId, forgeArtifactSlug(candidate.name)));
    writeNormalizedPage(prdPath, renderPrdBody(input.session, candidate), orderForgeFrontmatter({
      title: candidate.name,
      type: "forge-prd",
      project: input.project,
      prd_id: prdId,
      parent_feature: featureId,
      status: "draft",
      created_at: input.now,
      updated: input.now,
      planning_session: input.session.sessionId,
    }));

    const sliceIds: string[] = [];
    for (const sliceTitle of candidate.slices) {
      sliceCounter += 1;
      const sliceId = forgeSequenceId(input.project, "slice", sliceCounter);
      await writePlannedSlice({
        vaultRoot: input.vaultRoot,
        project: input.project,
        featureId,
        prdId,
        sliceId,
        title: sliceTitle,
        now: input.now,
        sessionId: input.session.sessionId,
      });
      sliceIds.push(sliceId);
    }
    prdArtifacts.push({ prdId, name: candidate.name, slices: sliceIds });
  }

  return { featureId, prds: prdArtifacts };
}

type PlannedSliceInput = {
  readonly vaultRoot: string;
  readonly project: string;
  readonly featureId: string;
  readonly prdId: string;
  readonly sliceId: string;
  readonly title: string;
  readonly now: string;
  readonly sessionId: string;
};

async function writePlannedSlice(input: PlannedSliceInput): Promise<void> {
  const paths = forgeSliceDocumentPaths(input.vaultRoot, input.project, input.sliceId);
  const dir = paths.dir;
  await mkdir(dir, { recursive: true });
  const baseFrontmatter = {
    title: `${input.sliceId} ${input.title}`,
    type: "forge-slice",
    project: input.project,
    task_id: input.sliceId,
    parent_prd: input.prdId,
    parent_feature: input.featureId,
    planning_session: input.sessionId,
    created_at: input.now,
    updated: input.now,
    status: "draft",
  };
  writeNormalizedPage(paths.indexPath, renderSliceHubBody(input), orderForgeFrontmatter({ ...baseFrontmatter, review_policy: { required_approvals: 1 } }));
  writeNormalizedPage(paths.planPath, renderSlicePlanBody(input), orderForgeFrontmatter({ ...baseFrontmatter, type: "forge-slice-plan" }));
  writeNormalizedPage(paths.testPlanPath, renderSliceTestPlanBody(input), orderForgeFrontmatter({ ...baseFrontmatter, type: "forge-slice-test-plan" }));
}
