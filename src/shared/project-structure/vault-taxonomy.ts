import { isAbsolute, relative, resolve } from "node:path";
import type { VaultPath } from "./path";

export type VaultFolderTaxonomyKind =
  | "canonical-project-knowledge"
  | "project-bound-research"
  | "cross-project-research"
  | "generated-projection"
  | "archived-or-legacy"
  | "ghost-or-quarantine-candidate"
  | "disallowed";

export type VaultFolderTaxonomyClassification = {
  readonly kind: VaultFolderTaxonomyKind;
  readonly path: VaultPath;
  readonly project?: string;
  readonly reason: string;
  readonly canonical: boolean;
  readonly writableByDefault: boolean;
  readonly lifecycleAuthority: boolean;
};

export type VaultFolderTaxonomyOptions = {
  readonly vaultRoot?: string;
};

const PROJECT_SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const TOPIC_SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const TOPIC_PATH = `(?:${TOPIC_SEGMENT}/)*${TOPIC_SEGMENT}`;
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PROJECT_PATTERN = new RegExp(`^${PROJECT_SEGMENT}$`, "u");
const PROJECT_RESEARCH_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/research/${TOPIC_PATH}/(?:_overview|${SLUG})\\.md$`, "u");
const CROSS_PROJECT_RESEARCH_PATTERN = new RegExp(`^research/${TOPIC_PATH}/(?:_overview|${SLUG})\\.md$`, "u");
const PROJECT_ZONE_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/(architecture|code-map|contracts|data|changes|runbooks|verification)/.+\\.md$`, "u");
const PROJECT_BUG_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/bugs/BUG-\\d{4}-${SLUG}\\.md$`, "u");
const PROJECT_MODULE_SPEC_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/modules/${PROJECT_SEGMENT}/spec\\.md$`, "u");
const PROJECT_FORGE_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/forge/(features|prds|slices|evidence|sessions|handovers)/.+\\.md$`, "u");
const PROJECT_ROOT_DOC_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/(_summary|context|decisions|learnings)\\.md$`, "u");
const PROJECT_GENERATED_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/(backlog|status|resume|handover)\\.md$`, "u");
const PROJECT_SPECS_INDEX_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/specs(?:/(features|prds|slices|archive))?/index\\.md$`, "u");
const PROJECT_LEGACY_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/(legacy|specs/archive)(?:/.*)?$`, "u");
const PROJECT_LEGACY_LIFECYCLE_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/specs/(features|prds|slices)/.+\\.md$`, "u");
const PROJECT_MARKDOWN_PATTERN = new RegExp(`^projects/(${PROJECT_SEGMENT})/.+\\.md$`, "u");

export function classifyVaultFolderPath(path: VaultPath, options: VaultFolderTaxonomyOptions = {}): VaultFolderTaxonomyClassification {
  const normalized = normalizeVaultTaxonomyPath(path, options);
  if (!normalized.path) {
    return classification("disallowed", "", normalized.reason, { canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  const rel = normalized.path;
  if (rel === "index.md" || rel === "projects/_dashboard.md") {
    return classification("generated-projection", rel, "workspace generated projection; not canonical truth", { canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  const generatedProject = matchProject(rel, PROJECT_GENERATED_PATTERN) ?? matchProject(rel, PROJECT_SPECS_INDEX_PATTERN);
  if (generatedProject) {
    return classification("generated-projection", rel, "project generated projection; not lifecycle authority", { project: generatedProject, canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  if (rel.startsWith("research/projects/")) {
    return classification("ghost-or-quarantine-candidate", rel, "legacy project research layout; use projects/<project>/research/<topic>/<slug>.md", { canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  const legacyLifecycleProject = matchProject(rel, PROJECT_LEGACY_LIFECYCLE_PATTERN);
  if (legacyLifecycleProject) {
    return classification("ghost-or-quarantine-candidate", rel, "legacy specs-backed lifecycle path; use projects/<project>/forge/** records", { project: legacyLifecycleProject, canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  if (rel === "legacy" || rel.startsWith("legacy/")) {
    return classification("archived-or-legacy", rel, "workspace legacy/archive material", { canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  const legacyProject = matchProject(rel, PROJECT_LEGACY_PATTERN);
  if (legacyProject) {
    return classification("archived-or-legacy", rel, "project legacy or specs-backed material; not current lifecycle truth", { project: legacyProject, canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  const rootProject = matchProject(rel, PROJECT_ROOT_DOC_PATTERN);
  if (rootProject) {
    return classification("canonical-project-knowledge", rel, "canonical project root knowledge", { project: rootProject, canonical: true, writableByDefault: true, lifecycleAuthority: false });
  }

  const moduleProject = matchProject(rel, PROJECT_MODULE_SPEC_PATTERN);
  if (moduleProject) {
    return classification("canonical-project-knowledge", rel, "canonical project module specification", { project: moduleProject, canonical: true, writableByDefault: true, lifecycleAuthority: false });
  }

  const zoneProject = matchProject(rel, PROJECT_ZONE_PATTERN);
  if (zoneProject) {
    return classification("canonical-project-knowledge", rel, "canonical project knowledge zone", { project: zoneProject, canonical: true, writableByDefault: true, lifecycleAuthority: false });
  }

  const bugProject = matchProject(rel, PROJECT_BUG_PATTERN);
  if (bugProject) {
    return classification("canonical-project-knowledge", rel, "canonical project bug artifact", { project: bugProject, canonical: true, writableByDefault: true, lifecycleAuthority: false });
  }

  const forgeProject = matchProject(rel, PROJECT_FORGE_PATTERN);
  if (forgeProject) {
    return classification("canonical-project-knowledge", rel, "canonical Forge lifecycle record", { project: forgeProject, canonical: true, writableByDefault: true, lifecycleAuthority: true });
  }

  const projectResearch = matchProject(rel, PROJECT_RESEARCH_PATTERN);
  if (projectResearch) {
    return classification("project-bound-research", rel, "canonical project-bound research", { project: projectResearch, canonical: true, writableByDefault: true, lifecycleAuthority: false });
  }

  if (CROSS_PROJECT_RESEARCH_PATTERN.test(rel)) {
    return classification("cross-project-research", rel, "canonical cross-project research", { canonical: true, writableByDefault: true, lifecycleAuthority: false });
  }

  const projectMarkdown = matchProject(rel, PROJECT_MARKDOWN_PATTERN);
  if (projectMarkdown) {
    return classification("ghost-or-quarantine-candidate", rel, "plausible project markdown outside canonical project zones", { project: projectMarkdown, canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  if (rel.includes("..") || rel.startsWith(".") || rel.startsWith("/")) {
    return classification("disallowed", rel, "invalid or unsafe vault path syntax", { canonical: false, writableByDefault: false, lifecycleAuthority: false });
  }

  return classification("disallowed", rel, "unknown or forbidden vault folder", { canonical: false, writableByDefault: false, lifecycleAuthority: false });
}

export function isAllowedCanonicalVaultPath(path: VaultPath, options?: VaultFolderTaxonomyOptions): boolean {
  return classifyVaultFolderPath(path, options).canonical;
}

export function isGeneratedVaultProjectionPath(path: VaultPath, options?: VaultFolderTaxonomyOptions): boolean {
  return classifyVaultFolderPath(path, options).kind === "generated-projection";
}

export function describeVaultFolderTaxonomy(): readonly string[] {
  return [
    "canonical-project-knowledge: projects/<project>/_summary.md, projects/<project>/context.md, decisions.md, learnings.md, modules/<module>/spec.md, architecture/**, contracts/**, bugs/BUG-NNNN-slug.md, forge/**",
    "project-bound-research: projects/<project>/research/<topic>/_overview.md; projects/<project>/research/<topic>/<slug>.md",
    "cross-project-research: research/<topic>/_overview.md; research/<topic>/<slug>.md",
    "generated-projection: index.md, projects/_dashboard.md, projects/<project>/backlog.md, status.md, resume.md, handover.md, specs/**/index.md",
    "archived-or-legacy: legacy/**, projects/<project>/legacy/**, projects/<project>/specs/** source material",
    "ghost-or-quarantine-candidate: plausible project markdown outside canonical zones, research/projects/<project>/** aliases",
    "disallowed: traversal, absolute paths outside vaultRoot, and unknown root markdown such as notes.md",
  ];
}

function normalizeVaultTaxonomyPath(path: VaultPath, options: VaultFolderTaxonomyOptions): { path: string | null; reason: string } {
  const raw = path.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!raw) return { path: null, reason: "empty vault path" };
  if (raw.split("/").some((part) => part === "..")) return { path: null, reason: "path traversal is not allowed" };

  if (isAbsolute(raw)) {
    if (!options.vaultRoot) return { path: null, reason: "absolute path requires vaultRoot" };
    const resolvedVault = resolve(options.vaultRoot);
    const resolvedPath = resolve(raw);
    if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}/`)) {
      return { path: null, reason: "absolute path is outside vault root" };
    }
    return { path: relative(resolvedVault, resolvedPath).replaceAll("\\", "/"), reason: "inside vault root" };
  }

  return { path: raw.replace(/^\/+/, ""), reason: "relative vault path" };
}

function matchProject(path: string, pattern: RegExp): string | null {
  const match = pattern.exec(path);
  const project = match?.[1];
  return project && PROJECT_PATTERN.test(project) ? project : null;
}

function classification(
  kind: VaultFolderTaxonomyKind,
  path: VaultPath,
  reason: string,
  options: {
    readonly project?: string;
    readonly canonical: boolean;
    readonly writableByDefault: boolean;
    readonly lifecycleAuthority: boolean;
  },
): VaultFolderTaxonomyClassification {
  return {
    kind,
    path,
    reason,
    canonical: options.canonical,
    writableByDefault: options.writableByDefault,
    lifecycleAuthority: options.lifecycleAuthority,
    ...(options.project ? { project: options.project } : {}),
  };
}
