import type { ForgeNextProjection } from "../../forge/workflow/status-projection";
import type { HandoverRecord } from "./handover-types";

export type PromptPacket = {
  readonly kind: "prompt-packet";
  readonly project: string;
  readonly nextAction: string;
  readonly statusTruth: ForgeNextProjection;
  readonly latestHandover: HandoverRecord | null;
  readonly prompt: string;
};

export function buildPromptPacket(input: {
  readonly project: string;
  readonly statusTruth: ForgeNextProjection;
  readonly latestHandover: HandoverRecord | null;
}): PromptPacket {
  const nextAction = readProjectionNextAction(input.statusTruth);
  return {
    kind: "prompt-packet",
    project: input.project,
    nextAction,
    statusTruth: input.statusTruth,
    latestHandover: input.latestHandover,
    prompt: renderPrompt(input.project, nextAction, input.statusTruth, input.latestHandover),
  };
}

function renderPrompt(project: string, nextAction: string, statusTruth: ForgeNextProjection, handover: HandoverRecord | null): string {
  return [
    `We are continuing ${project}.`,
    "",
    "Use Wiki as durable memory and Forge as the HTLS workflow layer.",
    "Do not use legacy fallback. Do not patch generated projections to make workflow proceed.",
    "",
    `Next action: ${nextAction}`,
    renderStatusLine(statusTruth),
    handover ? `Latest handover: ${handover.path}` : "Latest handover: none",
    handover ? `Related slices: ${handover.relatedSlices.join(", ") || "none"}` : "Related slices: none",
    "",
    "Previous handover prompt:",
    handover?.copyPastePrompt || "None recorded.",
  ].join("\n");
}

function renderStatusLine(statusTruth: ForgeNextProjection): string {
  if (statusTruth.status === "active") return `Active slice: ${statusTruth.activeSliceId}`;
  if (statusTruth.status === "ready") return `Ready slice: ${statusTruth.nextSliceId}`;
  if (statusTruth.status === "empty") return "No ready slice: plan next slice";
  if (statusTruth.status === "conflict") return `Conflict: ${statusTruth.rejection.code}`;
  return `Needs repair: ${statusTruth.diagnostics.join("; ")}`;
}

function readProjectionNextAction(projection: ForgeNextProjection): string {
  if (projection.status === "conflict") return "resolve-conflict";
  if (projection.status === "needs-repair") return "repair-canonical-records";
  return projection.nextAction;
}
