import { requireValue } from "../../cli-shared";
import { lifecycleOpen } from "./index";

export async function startFeature(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "feature-id");
  await lifecycleOpen(project, entityId, "feature");
  console.log(`started feature ${entityId}`);
}
