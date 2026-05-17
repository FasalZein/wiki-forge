import type { ForgeNextProjection } from "./status-projection";
import { renderKernelRejectionText } from "./render-rejection";
import { renderPhaseSkillPacket } from "./phase-skill-packet";

export function renderForgeNextText(projection: ForgeNextProjection): string {
  const body = renderForgeNextBody(projection);
  return withRepeatedActionableGuidance(body, projection);
}

function renderForgeNextBody(projection: ForgeNextProjection): string {
  switch (projection.status) {
    case "active":
      return `${projection.project}: continue ${projection.activeSliceId}`;
    case "ready":
      return `${projection.project}: start ${projection.nextSliceId}`;
    case "drafts":
      return [
        `${projection.project}: draft slices need release before start`,
        ...projection.draftSlices.flatMap((slice) => [
          `- ${slice.sliceId} ${slice.title}`,
          `  release: ${slice.commands.release}`,
          `  start after release: ${slice.commands.startAfterRelease}`,
        ]),
      ].join("\n");
    case "planning-session":
      return projection.nextAction === "create-planning-artifacts"
        ? `${projection.project}: create artifacts for planning session ${projection.featureName}`
        : `${projection.project}: continue planning session ${projection.featureName}`;
    case "empty":
      return `${projection.project}: no open Forge slices; project is complete unless the user wants more scope`;
    case "conflict":
      return renderKernelRejectionText(projection.rejection);
    case "needs-repair":
      return [`${projection.project}: repair canonical records`, ...projection.diagnostics.map((diagnostic) => `- ${diagnostic}`)].join("\n");
  }
}

function withRepeatedActionableGuidance(body: string, projection: ForgeNextProjection): string {
  const guidance = projection.nextCommand
    ? `Next command: ${projection.nextCommand}`
    : projection.noSafeCommandReason
      ? `No safe command: ${projection.noSafeCommandReason}`
      : null;
  const phasePacket = projection.phasePacket ? renderPhaseSkillPacket(projection.phasePacket) : null;
  const parts = [guidance, body, phasePacket, guidance].filter((part): part is string => Boolean(part));
  return parts.join("\n\n");
}

export function renderForgeNextJson(projection: ForgeNextProjection): string {
  return JSON.stringify(projection);
}
