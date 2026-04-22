import { requireForceAcknowledgement, requireValue } from "../../cli-shared";
import { computeEntityStatus, lifecycleClose } from "./index";

export async function closePrd(args: string[]): Promise<void> {
  const force = requireForceAcknowledgement(args, "close-prd");
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "prd-id");
  if (force) {
    const computedStatus = await computeEntityStatus(project, entityId, "prd");
    await lifecycleClose(project, entityId, "prd", force);
    console.log(`closed prd ${entityId} (forced)`);
    if (computedStatus !== "complete") {
      console.log(`\nWarning: --force overrode computed_status="${computedStatus}".`);
      console.log(`The PRD frontmatter now says status=complete, but feature-status`);
      console.log(`will still show computed_status="${computedStatus}" until child slices`);
      console.log(`are all done AND test-verified.`);
      console.log(`To resolve: verify-page all child slice pages to test-verified,`);
      console.log(`then run: wiki maintain ${project} --repo <path> --base <rev>`);
    }
  } else {
    await lifecycleClose(project, entityId, "prd", false);
    console.log(`closed prd ${entityId}`);
  }
}
