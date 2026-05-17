import type { loadForgeSliceStatus } from "../vault/load-project";
import { renderPhaseSkillPacket } from "./phase-skill-packet";

export function renderForgeSliceStatusText(status: Awaited<ReturnType<typeof loadForgeSliceStatus>>): string {
  if (status.status === "missing") return `${status.project}/${status.sliceId}: missing canonical slice hub`;
  if (status.status === "needs-repair") return `${status.project}/${status.sliceId}: repair canonical slice hub`;
  return [
    `${status.project}/${status.sliceId}: ${status.status}`,
    `lifecycle: ${status.lifecycleStatus}`,
    `next: ${status.nextAction}`,
    ...(status.phasePacket ? ["", renderPhaseSkillPacket(status.phasePacket)] : []),
  ].join("\n");
}
