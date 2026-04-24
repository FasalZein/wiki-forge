import { requireValue } from "../../cli-shared";
import { lifecycleOpen } from "./index";
import { printLine } from "../../lib/cli-output";

export async function startPrd(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const entityId = positional[1];
  requireValue(project, "project");
  requireValue(entityId, "prd-id");
  await lifecycleOpen(project, entityId, "prd");
  printLine(`started prd ${entityId}`);
}
