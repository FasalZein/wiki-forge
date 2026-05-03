import type { ForgeNextProjection } from "./status-projection";
import { renderKernelRejectionText } from "./render-rejection";

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
    case "empty":
      return `${projection.project}: no ready slice; plan next slice`;
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
  if (!guidance) return body;
  return [guidance, body, "", guidance].join("\n");
}

export function renderForgeNextJson(projection: ForgeNextProjection): string {
  return JSON.stringify(projection);
}
