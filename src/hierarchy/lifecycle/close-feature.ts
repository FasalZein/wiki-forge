import { requireForceAcknowledgement, requireValue } from "../../cli-shared";
import { computeEntityStatus, lifecycleClose } from "./index";
import { printLine } from "../../lib/cli-output";

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
    printLine(`closed feature ${entityId} (forced)`);
    if (computedStatus !== "complete") {
      printLine(`\nWarning: --force overrode computed_status="${computedStatus}".`);
      printLine(`The feature frontmatter now says status=complete, but feature-status`);
      printLine(`will still show computed_status="${computedStatus}" until child slices`);
      printLine(`are all done AND test-verified.`);
      printLine(`To resolve: verify-page all child slice/PRD/feature pages to test-verified,`);
      printLine(`then run: wiki maintain ${project} --repo <path> --base <rev>`);
    }
  } else {
    await lifecycleClose(project, entityId, "feature", false);
    printLine(`closed feature ${entityId}`);
  }
}
