import type { ForgeNextProjection } from "../../forge/workflow/status-projection";
import type { HandoverStaleness } from "./handover/freshness";
import type { HandoverRecord } from "./handover-types";

export type PromptPacket = {
  readonly kind: "prompt-packet";
  readonly project: string;
  readonly nextAction: string;
  readonly statusTruth: ForgeNextProjection;
  readonly latestHandover: HandoverRecord | null;
  readonly handoverStaleness: HandoverStaleness | null;
  readonly recoveryPrompt: string | null;
  readonly prompt: string;
};

export function buildPromptPacket(input: {
  readonly project: string;
  readonly statusTruth: ForgeNextProjection;
  readonly latestHandover: HandoverRecord | null;
  readonly handoverStaleness?: HandoverStaleness | null;
  readonly recoveryPrompt?: string | null;
}): PromptPacket {
  const nextAction = readProjectionNextAction(input.statusTruth);
  const handoverStaleness = input.handoverStaleness ?? null;
  const recoveryPrompt = input.recoveryPrompt ?? null;
  return {
    kind: "prompt-packet",
    project: input.project,
    nextAction,
    statusTruth: input.statusTruth,
    latestHandover: input.latestHandover,
    handoverStaleness,
    recoveryPrompt,
    prompt: renderPrompt(input.project, nextAction, input.statusTruth, input.latestHandover, handoverStaleness, recoveryPrompt),
  };
}

function renderPrompt(
  project: string,
  nextAction: string,
  statusTruth: ForgeNextProjection,
  handover: HandoverRecord | null,
  handoverStaleness: HandoverStaleness | null,
  recoveryPrompt: string | null,
): string {
  const handoverPromptLabel = handoverStaleness?.status === "stale"
    ? "Operator prompt from latest handover (stale; context only):"
    : "Operator prompt from latest handover:";
  return [
    `We are continuing ${project}.`,
    "",
    "Use Wiki as durable memory and Forge as the workflow truth layer.",
    "Do not reconstruct the prior conversation. Read only the latest handover, current checkpoint/Forge truth, and explicitly referenced artifacts.",
    "Do not use legacy fallback. Do not patch generated projections to make workflow proceed.",
    "",
    "Minimal refresh:",
    `- wiki checkpoint ${project} --repo <path> --base HEAD --json`,
    `- wiki forge next ${project} --repo <path> --json`,
    "Use broad wiki queries only if the handover is stale or a referenced artifact is missing.",
    "",
    `Next action: ${nextAction}`,
    renderStatusLine(statusTruth),
    handover ? `Latest handover: ${handover.path}` : "Latest handover: none",
    handover ? `Related slices: ${handover.relatedSlices.join(", ") || "none"}` : "Related slices: none",
    handover?.baseRevision ? `Handover base revision: ${handover.baseRevision}` : "Handover base revision: none recorded",
    "",
    handoverPromptLabel,
    handover?.copyPastePrompt || "None recorded.",
    ...(recoveryPrompt ? ["", "Current recovery prompt:", recoveryPrompt] : []),
  ].join("\n");
}

function renderStatusLine(statusTruth: ForgeNextProjection): string {
  if (statusTruth.status === "active") return `Active slice: ${statusTruth.activeSliceId}`;
  if (statusTruth.status === "ready") return `Ready slice: ${statusTruth.nextSliceId}`;
  if (statusTruth.status === "drafts") return `Draft slices need release: ${statusTruth.draftSlices.map((slice) => slice.sliceId).join(", ")}`;
  if (statusTruth.status === "planning-session") return `Planning session: ${statusTruth.featureName} (${statusTruth.planningStatus})`;
  if (statusTruth.status === "empty") return "No ready slice: plan next slice";
  if (statusTruth.status === "conflict") return `Conflict: ${statusTruth.rejection.code}`;
  return `Needs repair: ${statusTruth.diagnostics.join("; ")}`;
}

function readProjectionNextAction(projection: ForgeNextProjection): string {
  if (projection.status === "conflict") return "resolve-conflict";
  if (projection.status === "needs-repair") return "repair-canonical-records";
  return projection.nextAction;
}
