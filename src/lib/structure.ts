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

type ProjectDocKind =
  | "project-file"
  | "module-spec"
  | "freeform-zone-doc"
  | "spec-index"
  | "spec-onboarding-plan"
  | "spec-prd"
  | "spec-plan"
  | "spec-test-plan"
  | "task-hub-index"
  | "task-hub-plan"
  | "task-hub-test-plan";

export function projectSpecsDir(project: string) {
  return join(projectRoot(project), "specs");
}

export function projectSpecsIndexPath(project: string) {
  return join(projectSpecsDir(project), "index.md");
}

export function projectOnboardingPlanPath(project: string) {
  return join(projectSpecsDir(project), "onboarding-plan.md");
}

export function projectPrdPath(project: string, slug: string) {
  return join(projectSpecsDir(project), `prd-${slug}.md`);
}

export function projectPlanPath(project: string, slug: string) {
  return join(projectSpecsDir(project), `plan-${slug}.md`);
}

export function projectTestPlanPath(project: string, slug: string) {
  return join(projectSpecsDir(project), `test-plan-${slug}.md`);
}

export function projectTaskDir(project: string, taskId: string) {
  return join(projectSpecsDir(project), taskId);
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

export function projectRelativeDocPath(project: string, filePath: string) {
  return relative(projectRoot(project), filePath).replaceAll("\\", "/");
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

export function classifyProjectDocPath(relPath: string): ProjectDocKind | null {
  const rel = relPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (["_summary.md", "backlog.md", "decisions.md", "learnings.md"].includes(rel)) return "project-file";
  if (/^modules\/[^/]+\/spec\.md$/u.test(rel)) return "module-spec";
  if (new RegExp(`^(?:${PROJECT_FREEFORM_DOC_DIRS.join("|")})\/.+\.md$`, "u").test(rel)) return "freeform-zone-doc";
  if (rel === "specs/index.md") return "spec-index";
  if (rel === "specs/onboarding-plan.md") return "spec-onboarding-plan";
  if (/^specs\/prd-[^/]+\.md$/u.test(rel)) return "spec-prd";
  if (/^specs\/plan-[^/]+\.md$/u.test(rel)) return "spec-plan";
  if (/^specs\/test-plan-[^/]+\.md$/u.test(rel)) return "spec-test-plan";
  const taskMatch = rel.match(/^specs\/([^/]+)\/(index|plan|test-plan)\.md$/u);
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
    "specs/onboarding-plan.md",
    "specs/prd-<slug>.md",
    "specs/plan-<slug>.md",
    "specs/test-plan-<slug>.md",
    "specs/<TASK-ID>/{index,plan,test-plan}.md",
  ].join("; ");
}
