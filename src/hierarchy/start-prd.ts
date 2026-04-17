import { requireValue } from "../cli-shared";
import { lifecycleOpen } from "./lifecycle";

export async function startPrd(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "prd-id");
  await lifecycleOpen(project, entityId, "prd");
  console.log(`started prd ${entityId}`);
}
