import type { VaultPath } from "../project-structure/path";

export type ForgeHandoverRecord = {
  readonly kind: "handover";
  readonly path: VaultPath;
  readonly title: string;
  readonly project: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly agent: string;
  readonly relatedFeatures: readonly string[];
  readonly relatedPrds: readonly string[];
  readonly relatedSlices: readonly string[];
  readonly summary: string;
  readonly nextAction: string;
  readonly copyPastePrompt: string;
  readonly baseRevision?: string;
  readonly runbookCommands?: readonly string[];
};
