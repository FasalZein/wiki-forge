export type { ParsedProjectPath, VaultPath } from "../../shared/project-structure/path";
export { inferProjectFromPath, isProjectIndexPath, isProjectionPath, isSliceHubPath, parseProjectPath } from "../../shared/project-structure/path";
export type { VaultFolderTaxonomyClassification, VaultFolderTaxonomyKind, VaultFolderTaxonomyOptions } from "../../shared/project-structure/vault-taxonomy";
export { classifyVaultFolderPath, describeVaultFolderTaxonomy, isAllowedCanonicalVaultPath, isGeneratedVaultProjectionPath } from "../../shared/project-structure/vault-taxonomy";
