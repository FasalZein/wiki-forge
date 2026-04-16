import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { projectRoot } from "../cli-shared";

export const PROJECT_FREEFORM_DOC_DIRS = [
  "architecture",
  "code-map",
  "contracts",
  "data",
  "changes",
  "runbooks",
  "verification",
  "legacy",
] as const;

export const TASK_ID_PATTERN = /^(?:[A-Z0-9]+-)+\d+$/u;
export const FEATURE_ID_PATTERN = /^FEAT-\d{3,}$/u;
export const PRD_ID_PATTERN = /^PRD-\d{3,}$/u;
export const SPEC_VIEW_FAMILIES = ["features", "prds", "slices", "archive"] as const;

export type SpecViewFamily = (typeof SPEC_VIEW_FAMILIES)[number];

type ProjectDocKind =
  | "project-file"
  | "module-spec"
  | "freeform-zone-doc"
  | "spec-index"
  | "spec-features-index"
  | "spec-prds-index"
  | "spec-slices-index"
  | "spec-archive-index"
  | "spec-onboarding-plan"
  | "spec-feature"
  | "spec-prd"
  | "spec-plan"
  | "spec-test-plan"
  | "task-hub-index"
  | "task-hub-plan"
  | "task-hub-test-plan"
  | "session-handover";

export function projectSpecsDir(project: string) {
  return join(projectRoot(project), "specs");
}

export function workspaceIndexPath() {
  return join(VAULT_ROOT, "index.md");
}

export function workspaceProjectsDashboardPath() {
  return join(VAULT_ROOT, "projects", "_dashboard.md");
}

export function projectSpecsIndexPath(project: string) {
  return join(projectSpecsDir(project), "index.md");
}

export function projectOnboardingPlanPath(project: string) {
  return join(projectSpecsDir(project), "onboarding-plan.md");
}

export function projectSpecViewIndexPath(project: string, family: SpecViewFamily) {
  return join(projectSpecsDir(project), family, "index.md");
}

export function projectFeaturesDir(project: string) {
  return join(projectSpecsDir(project), "features");
}

export function projectFeaturePath(project: string, featureId: string, slug: string) {
  return join(projectFeaturesDir(project), `${featureId}-${slug}.md`);
}

export function projectPrdsDir(project: string) {
  return join(projectSpecsDir(project), "prds");
}

export function projectPrdPath(project: string, prdId: string, slug: string) {
  return join(projectPrdsDir(project), `${prdId}-${slug}.md`);
}

export function projectPlanPath(project: string, slug: string) {
  return join(projectSpecsDir(project), `plan-${slug}.md`);
}

export function projectTestPlanPath(project: string, slug: string) {
  return join(projectSpecsDir(project), `test-plan-${slug}.md`);
}

export function projectSlicesDir(project: string) {
  return join(projectSpecsDir(project), "slices");
}

export function projectTaskDir(project: string, taskId: string) {
  return join(projectSlicesDir(project), taskId);
}

export function projectTaskHubPath(project: string, taskId: string) {
  return join(projectTaskDir(project, taskId), "index.md");
}

export function projectTaskPlanPath(project: string, taskId: string) {
  return join(projectTaskDir(project, taskId), "plan.md");
}

export function projectTaskTestPlanPath(project: string, taskId: string) {
  return join(projectTaskDir(project, taskId), "test-plan.md");
}

export function projectModuleSpecPath(project: string, moduleName: string) {
  return join(projectRoot(project), "modules", moduleName, "spec.md");
}

export function toVaultMarkdownPath(filePath: string) {
  return relative(VAULT_ROOT, filePath).replaceAll("\\", "/");
}

export function toVaultWikilinkPath(filePath: string) {
  return toVaultMarkdownPath(filePath).replace(/\.md$/u, "");
}

export function isCanonicalTaskId(value: string) {
  return TASK_ID_PATTERN.test(value.trim());
}

export function isCanonicalFeatureId(value: string) {
  return FEATURE_ID_PATTERN.test(value.trim());
}

export function isCanonicalPrdId(value: string) {
  return PRD_ID_PATTERN.test(value.trim());
}

export function classifyProjectDocPath(relPath: string): ProjectDocKind | null {
  const rel = relPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (["_summary.md", "backlog.md", "decisions.md", "learnings.md"].includes(rel)) return "project-file";
  if (/^modules\/[^/]+\/spec\.md$/u.test(rel)) return "module-spec";
  if (new RegExp(`^(?:${PROJECT_FREEFORM_DOC_DIRS.join("|")})\/.+\.md$`, "u").test(rel)) return "freeform-zone-doc";
  if (rel === "specs/index.md") return "spec-index";
  if (rel === "specs/features/index.md") return "spec-features-index";
  if (rel === "specs/prds/index.md") return "spec-prds-index";
  if (rel === "specs/slices/index.md") return "spec-slices-index";
  if (rel === "specs/archive/index.md") return "spec-archive-index";
  if (rel === "specs/onboarding-plan.md") return "spec-onboarding-plan";
  if (/^specs\/features\/FEAT-\d{3,}-[^/]+\.md$/u.test(rel)) return "spec-feature";
  if (/^specs\/prds\/PRD-\d{3,}-[^/]+\.md$/u.test(rel)) return "spec-prd";
  if (/^specs\/plan-[^/]+\.md$/u.test(rel)) return "spec-plan";
  if (/^specs\/test-plan-[^/]+\.md$/u.test(rel)) return "spec-test-plan";
  if (/^handovers\/[^/]+\.md$/u.test(rel)) return "session-handover";
  const taskMatch = rel.match(/^specs\/slices\/([^/]+)\/(index|plan|test-plan)\.md$/u);
  if (!taskMatch) return null;
  const [, taskId, fileName] = taskMatch;
  if (!taskId || !isCanonicalTaskId(taskId)) return null;
  if (fileName === "index") return "task-hub-index";
  if (fileName === "plan") return "task-hub-plan";
  return "task-hub-test-plan";
}

export function isAllowedProjectDocPath(relPath: string) {
  return classifyProjectDocPath(relPath) !== null;
}

export function describeAllowedProjectDocPaths() {
  return [
    "_summary.md | backlog.md | decisions.md | learnings.md",
    "modules/<module>/spec.md",
    `${PROJECT_FREEFORM_DOC_DIRS.join(" | ")}/**/*.md`,
    "specs/index.md",
    "specs/features/index.md",
    "specs/prds/index.md",
    "specs/slices/index.md",
    "specs/archive/index.md",
    "specs/onboarding-plan.md",
    "specs/features/FEAT-<nnn>-<slug>.md",
    "specs/prds/PRD-<nnn>-<slug>.md",
    "specs/plan-<slug>.md",
    "specs/test-plan-<slug>.md",
    "specs/slices/<TASK-ID>/{index,plan,test-plan}.md",
    "handovers/<YYYY-MM-DD>-<session-id>.md",
  ].join("; ");
}
