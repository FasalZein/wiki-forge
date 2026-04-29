import type { ProjectRecord, SliceRecord, ForgeDiagnostic, VaultDocument } from "./document";
import { decodeProjectRecord, decodeSliceRecord } from "./frontmatter-codec";
import { isProjectIndexPath, isProjectionPath, isSliceHubPath } from "./path";

export type LegacyClassification =
  | { readonly status: "valid"; readonly canonical: true; readonly record: ProjectRecord | SliceRecord }
  | { readonly status: "repairable"; readonly canonical: false; readonly diagnostics: readonly ForgeDiagnostic[] }
  | { readonly status: "quarantined"; readonly canonical: false; readonly reason: string; readonly diagnostics: readonly ForgeDiagnostic[] }
  | { readonly status: "projection"; readonly canonical: false; readonly reason: string };

export function classifyLegacyDocument(document: VaultDocument): LegacyClassification {
  if (isProjectionDocument(document)) {
    return {
      status: "projection",
      canonical: false,
      reason: "generated or projection document is not lifecycle truth",
    };
  }

  if (isSliceHubPath(document.path)) {
    const decoded = decodeSliceRecord(document);
    if (decoded.status === "valid") return { status: "valid", canonical: true, record: decoded.record };
    if (decoded.status === "repairable") return { status: "repairable", canonical: false, diagnostics: decoded.diagnostics };
    return {
      status: "quarantined",
      canonical: false,
      reason: "document does not match a Forge canonical lifecycle shape",
      diagnostics: decoded.diagnostics,
    };
  }

  if (isProjectIndexPath(document.path)) {
    const decoded = decodeProjectRecord(document);
    if (decoded.status === "valid") return { status: "valid", canonical: true, record: decoded.record };
    if (decoded.status === "repairable") return { status: "repairable", canonical: false, diagnostics: decoded.diagnostics };
    return {
      status: "quarantined",
      canonical: false,
      reason: "document does not match a Forge canonical lifecycle shape",
      diagnostics: decoded.diagnostics,
    };
  }

  return {
    status: "quarantined",
    canonical: false,
    reason: "document does not match a Forge canonical lifecycle shape",
    diagnostics: [
      {
        code: "UnknownLifecycleShape",
        message: "document has project metadata but no recognized canonical record kind",
      },
    ],
  };
}

function isProjectionDocument(document: VaultDocument): boolean {
  const type = document.frontmatter.type;
  const generated = document.frontmatter.generated;
  const specKind = document.frontmatter.spec_kind;
  return isProjectionPath(document.path)
    || type === "projection"
    || generated === true
    || specKind === "projection";
}
