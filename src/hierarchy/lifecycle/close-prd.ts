import { requireForceAcknowledgement, requireValue } from "../../cli-shared";
import { computeEntityStatus, lifecycleClose } from "./index";
import { printLine } from "../../lib/cli-output";

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
    printLine(`closed prd ${entityId} (forced)`);
    if (computedStatus !== "complete") {
      printLine(`\nWarning: --force overrode computed_status="${computedStatus}".`);
      printLine(`The PRD frontmatter now says status=complete, but feature-status`);
      printLine(`will still show computed_status="${computedStatus}" until child slices`);
      printLine(`are all done AND test-verified.`);
      printLine(`To resolve: verify-page all child slice pages to test-verified,`);
      printLine(`then run: wiki maintain ${project} --repo <path> --base <rev>`);
    }
  } else {
    await lifecycleClose(project, entityId, "prd", false);
    printLine(`closed prd ${entityId}`);
  }
}
