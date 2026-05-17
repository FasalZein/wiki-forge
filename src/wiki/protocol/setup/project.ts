import { readdirSync, rmdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import matter from "gray-matter";
import { MODULE_REQUIRED_HEADINGS, PROJECT_FILES, VAULT_ROOT } from "../../../constants";
import { assertExists, mkdirIfMissing, moduleTitle, normalizeFrontmatterFormatting, nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter, scaffoldFile, today, writeNormalizedPage } from "../../../cli-shared";
import { exists, readText, writeText } from "../../../lib/fs";
import { slugifySegment } from "../../../lib/research";
import { projectModuleSpecPath, projectOnboardingPlanPath, projectSpecsDir } from "../../../lib/structure";
import {
  defaultCrossLinksSection,
  defaultDataModelSection,
  defaultDependenciesSection,
  defaultHighlightsSection,
  defaultInterfacesSection,
  defaultKeyFilesSection,
  defaultOwnershipSection,
  defaultVerificationSection,
  ensurePrimaryHeading,
  ensureSection,
  normalizeInterfacesSection,
  normalizeModuleFrontmatter,
  normalizeTableSpacing,
} from "../../../module-format";
import { writeProjectIndex } from "../../project-views";
import { syncProtocolForProject } from "./index";
import { printJson, printLine } from "../../../lib/cli-output";

export async function scaffoldProject(project: string | undefined) {
  requireValue(project, "project");
  assertCanonicalProjectSlug(project);
  assertNoDuplicateProjectSlug(project);
  const root = projectRoot(project);
  let created = 0;
  created += (await mkdirIfMissing(root)) ? 1 : 0;
  for (const file of PROJECT_FILES) {
    const path = join(root, file);
    if (!await exists(path)) {
      writeNormalizedPage(path, scaffoldFile(project, file), {});
      printLine(`created ${relative(VAULT_ROOT, path)}`);
      created += 1;
    }
  }
  if (created > 0) printLine(`scaffolded ${project}`);
  await writeProjectIndex(project);
}

export async function pruneEmptyProjectDirs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const root = projectRoot(project);
  await assertExists(root, `project not found: ${relative(VAULT_ROOT, root)}`);
  const write = args.includes("--write");
  const json = args.includes("--json");
  const emptyDirs = collectEmptyDirs(root);
  if (write) {
    for (const dir of [...emptyDirs].sort((left, right) => right.length - left.length)) rmdirSync(dir);
  }
  const relativeDirs = emptyDirs.map((dir) => relative(VAULT_ROOT, dir).replaceAll("\\", "/")).sort();
  const payload = { project, write, emptyDirs: relativeDirs, count: relativeDirs.length };
  if (json) return printJson(payload);
  printLine(`${write ? "removed" : "would remove"} ${relativeDirs.length} empty project director${relativeDirs.length === 1 ? "y" : "ies"} for ${project}`);
  for (const dir of relativeDirs) printLine(`- ${dir}`);
  if (!write && relativeDirs.length > 0) printLine("dry run only; pass --write to remove empty directories");
}

export async function onboardProject(args: string[]) {
  const options = parseOnboardPlanOptions(args);
  await scaffoldProject(options.project);
  if (options.repo) {
    const outputPath = projectOnboardingPlanPath(options.project);
    await mkdirIfMissing(projectSpecsDir(options.project));
    await writeText(outputPath, await renderOnboardingPlan(options.project, options.repo));
    printLine(`created ${relative(VAULT_ROOT, outputPath)}`);
    await syncProtocolForProject(options.project, options.repo);
  }
  printLine(`onboarded ${options.project} scaffold in ${relative(VAULT_ROOT, projectRoot(options.project))}`);
}

export async function onboardPlan(args: string[]) {
  const options = parseOnboardPlanOptions(args);
  await assertExistingProject(options.project);
  const rendered = await renderOnboardingPlan(options.project, options.repo);
  if (!options.write) return printLine(rendered);
  const outputPath = projectOnboardingPlanPath(options.project);
  await mkdirIfMissing(projectSpecsDir(options.project));
  await writeText(outputPath, rendered);
  printLine(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export async function createModule(args: string[]) {
  const project = args[0];
  const moduleName = args[1];
  requireValue(project, "project");
  requireValue(moduleName, "module");
  const sourceIndex = args.indexOf("--source");
  const sourcePaths = sourceIndex >= 0 ? args.slice(sourceIndex + 1).filter((arg) => !arg.startsWith("--")) : [];
  const specPath = await createModuleInternal(project, moduleName, sourcePaths);
  printLine(`created ${relative(VAULT_ROOT, specPath)}`);
}

export async function createModuleInternal(project: string, moduleName: string, sourcePaths: string[]) {
  await assertExistingProject(project);
  const specPath = projectModuleSpecPath(project, moduleName);
  await mkdirIfMissing(join(projectRoot(project), "modules", moduleName));
  if (await exists(specPath)) throw new Error(`module spec already exists: ${relative(VAULT_ROOT, specPath)}`);
  const data = orderFrontmatter({ title: moduleTitle(moduleName), type: "module", project, module: moduleName, created_at: nowIso(), updated: nowIso(), status: "current", verification_level: "scaffold", ...(sourcePaths.length ? { source_paths: sourcePaths.map((value) => value.replaceAll("\\", "/")) } : {}) }, ["title", "type", "project", "module", "created_at", "updated", "status", "verification_level", "source_paths"]);
  const body = [
    `# ${moduleTitle(moduleName)}`,
    "", "## Highlights", "", defaultHighlightsSection(),
    "", "## Ownership", "", defaultOwnershipSection(),
    "", "## Key Files", "", defaultKeyFilesSection(),
    "", "## Interfaces", "", defaultInterfacesSection(),
    "", "## Data Model", "", defaultDataModelSection(),
    "", "## Dependencies", "", defaultDependenciesSection(),
    "", "## Verification", "", defaultVerificationSection(),
    "", "## Cross Links", "", defaultCrossLinksSection(project, moduleName), "",
  ].join("\n");
  writeNormalizedPage(specPath, body, data);
  return specPath;
}

export async function normalizeModule(args: string[]) {
  const project = args[0];
  const moduleName = args[1];
  const write = args.includes("--write");
  requireValue(project, "project");
  requireValue(moduleName, "module");
  const specPath = projectModuleSpecPath(project, moduleName);
  await assertExists(specPath, `module spec not found: ${relative(VAULT_ROOT, specPath)}`);
  const parsed = safeMatter(specPath, await readText(specPath));
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, specPath)}`);
  const changes: string[] = [];
  const data = normalizeModuleFrontmatter(project, moduleName, parsed.data, changes);
  let body = parsed.content.replace(/\r\n/g, "\n").trim();
  body = ensurePrimaryHeading(body, moduleTitle(moduleName), changes);
  body = normalizeInterfacesSection(body, changes);
  body = normalizeTableSpacing(body, changes);
  body = ensureSection(body, "## Highlights", defaultHighlightsSection(), changes);
  body = ensureSection(body, "## Ownership", defaultOwnershipSection(), changes);
  body = ensureSection(body, "## Key Files", defaultKeyFilesSection(), changes);
  body = ensureSection(body, "## Interfaces", defaultInterfacesSection(), changes);
  body = ensureSection(body, "## Data Model", defaultDataModelSection(), changes);
  body = ensureSection(body, "## Dependencies", defaultDependenciesSection(), changes);
  body = ensureSection(body, "## Verification", defaultVerificationSection(), changes);
  body = ensureSection(body, "## Cross Links", defaultCrossLinksSection(project, moduleName), changes);
  if (!changes.length) return printLine(`module already normalized: ${project}/${moduleName}`);
  printLine(`${write ? "normalized" : "would normalize"} ${project}/${moduleName}:`);
  for (const change of changes) printLine(`- ${change}`);
  if (!write) return printLine("dry run only; pass --write to apply changes");
  writeNormalizedPage(specPath, body, data);
  printLine(`updated ${relative(VAULT_ROOT, specPath)}`);
}

function parseOnboardPlanOptions(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  if (repoIndex >= 0) requireValue(repo, "repo");
  return { project, repo, write: args.includes("--write") };
}

async function assertExistingProject(project: string): Promise<void> {
  if (!await exists(projectRoot(project))) {
    throw new Error(`project not found: ${project}. Run scaffold-project with a canonical project slug before writing project artifacts.`);
  }
}

function assertCanonicalProjectSlug(project: string): void {
  if (project !== slugifySegment(project)) {
    throw new Error(`project names must be canonical slugs. Use '${slugifySegment(project)}' instead of '${project}'.`);
  }
}

function assertNoDuplicateProjectSlug(project: string): void {
  const projectsRoot = join(VAULT_ROOT, "projects");
  let existingProjects: string[] = [];
  try {
    existingProjects = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
  const requestedSlug = slugifySegment(project);
  const duplicate = existingProjects.find((existing) => existing !== project && slugifySegment(existing) === requestedSlug);
  if (duplicate) throw new Error(`project '${project}' duplicates existing project '${duplicate}' after slug normalization.`);
}

function collectEmptyDirs(root: string): string[] {
  return collectEmptyDirsInternal(root).filter((dir) => dir !== root);
}

function collectEmptyDirsInternal(root: string): string[] {
  const emptyDirs: string[] = [];
  const entries = readdirSync(root);
  let hasFile = false;
  for (const entry of entries) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (!stats.isDirectory()) {
      hasFile = true;
      continue;
    }
    emptyDirs.push(...collectEmptyDirsInternal(path));
  }
  const directoryEntries = entries.filter((entry) => statSync(join(root, entry)).isDirectory());
  const allChildDirectoriesAreEmpty = directoryEntries.every((entry) => emptyDirs.includes(join(root, entry)));
  if (!hasFile && allChildDirectoriesAreEmpty) emptyDirs.push(root);
  return emptyDirs;
}

async function detectResearchDirs(repo: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const candidate of ["docs/research", "docs", "research"]) {
    const candidatePath = join(repo, candidate);
    if (await exists(candidatePath)) {
      try {
        const count = [...new Bun.Glob("**/*.md").scanSync({ cwd: candidatePath, onlyFiles: true })].length;
        if (count > 0) dirs.push(`${candidate}/ (${count} docs)`);
      } catch {}
    }
  }
  return dirs;
}

async function renderOnboardingPlan(project: string, repo?: string) {
  const data = orderFrontmatter({ title: `${project} Onboarding Plan`, type: "spec", project, created_at: nowIso(), updated: nowIso(), status: "current", repo: repo ?? "TODO", source_of_truth: "code", related_playbook: "wiki/concepts/project-onboarding-playbook.md" }, ["title", "type", "project", "created_at", "updated", "status", "repo", "source_of_truth", "related_playbook"]);
  const researchDirs = repo ? await detectResearchDirs(repo) : [];
  const slices = [
    "#### Slice A: Repo/App/Package Map", "", "- [ ] Identify apps, packages, services, and entry points", "- [ ] Identify build/test/dev tooling", "- [ ] Identify deployment/runtime surfaces", `- [ ] Seed \`projects/${project}/code-map/*.md\` and summary inputs`,
    "", "#### Slice B: Module And Interface Map", "", "- [ ] Identify module boundaries", "- [ ] Map routes, handlers, services, repositories, jobs, and events", "- [ ] Map frontend feature boundaries and external surfaces", `- [ ] Seed \`projects/${project}/modules/*/spec.md\`, \`architecture/\`, and \`contracts/\``,
    "", "#### Slice C: Data Model", "", "- [ ] Identify schema files, migrations, tables, and key relationships", "- [ ] Identify critical calculations and invariants", `- [ ] Seed \`projects/${project}/data/*.md\``,
    "", "#### Slice D: Verification And Operations", "", "- [ ] Identify tests, runtime verification signals, and operational runbooks", `- [ ] Seed \`projects/${project}/verification/*.md\` and \`runbooks/*.md\``,
  ];
  if (researchDirs.length) {
    slices.push(
      "", "#### Slice F: Research Layer", "",
      `Detected research docs in repo: ${researchDirs.join(", ")}`, "",
      `- [ ] Review existing research docs for key findings and architectural decisions`,
      `- [ ] Treat repo-local research docs as source material, not the active research workflow`,
      `- [ ] Run \`/research\` for any net-new investigation or option comparison`,
      `- [ ] File high-signal findings into the vault with \`wiki research file <topic> --project ${project} <title>\``,
      `- [ ] Link research pages to relevant module specs and PRDs`,
      `- [ ] Record research-driven decisions as ADRs under \`projects/${project}/adrs/\` and keep \`projects/${project}/decisions.md\` as the index`,
    );
  }
  const body = [`# ${project} Onboarding Plan`, "", "> [!summary]", "> Canonical onboarding plan for this project. Use it to map repo structure into maintained wiki modules and verification pages.", "", `Project-specific execution plan for onboarding \`${project}\` into the Knowledge vault using the canonical [[wiki/concepts/project-onboarding-playbook|Project Onboarding Playbook]].`, "", "## Inputs", "", `- Project: \`${project}\``, `- Repo: \`${repo ?? "TODO"}\``, "- Maintained wiki root: `~/Knowledge/projects/`", "- Source of truth: code", "", "## Phases", "", "### Phase 1: Prepare", "", "- [ ] Confirm project name and repo path", "- [ ] Read `index.md` and check for an existing project entry", `- [ ] Run \`wiki onboard ${project}${repo ? ` --repo ${repo}` : " --repo <path>"}\` if the project scaffold is missing`, "- [ ] Decide whether to onboard the whole repo or the highest-signal modules first", "", "### Phase 2: Parallel Exploration Slices", "", ...slices, ""].join("\n");
  return normalizeFrontmatterFormatting(matter.stringify(body, data), data);
}
