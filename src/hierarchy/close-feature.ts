import { requireForceAcknowledgement, requireValue } from "../cli-shared";
import { computeEntityStatus, lifecycleClose } from "./lifecycle";

export async function closeFeature(args: string[]): Promise<void> {
  const force = requireForceAcknowledgement(args, "close-feature");
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "feature-id");
  if (force) {
    const computedStatus = await computeEntityStatus(project, entityId, "feature");
    await lifecycleClose(project, entityId, "feature", force);
    console.log(`closed feature ${entityId} (forced)`);
    if (computedStatus !== "complete") {
      console.log(`\nWarning: --force overrode computed_status="${computedStatus}".`);
      console.log(`The feature frontmatter now says status=complete, but feature-status`);
      console.log(`will still show computed_status="${computedStatus}" until child slices`);
      console.log(`are all done AND test-verified.`);
      console.log(`To resolve: verify-page all child slice/PRD/feature pages to test-verified,`);
      console.log(`then run: wiki maintain ${project} --repo <path> --base <rev>`);
    }
  } else {
    await lifecycleClose(project, entityId, "feature", false);
    console.log(`closed feature ${entityId}`);
  }
}
