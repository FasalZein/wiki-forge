import type { ForgeNextProjection } from "./status-projection";
import { renderKernelRejectionText } from "./render-rejection";

export function renderForgeNextText(projection: ForgeNextProjection): string {
  switch (projection.status) {
    case "active":
      return `${projection.project}: continue ${projection.activeSliceId}`;
    case "ready":
      return `${projection.project}: start ${projection.nextSliceId}`;
    case "empty":
      return `${projection.project}: no ready slice; plan next slice`;
    case "conflict":
      return renderKernelRejectionText(projection.rejection);
    case "needs-repair":
      return [`${projection.project}: repair canonical records`, ...projection.diagnostics.map((diagnostic) => `- ${diagnostic}`)].join("\n");
  }
}

export function renderForgeNextJson(projection: ForgeNextProjection): string {
  return JSON.stringify(projection);
}
