import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { CODE_FILE_PATTERN, VAULT_ROOT } from "../constants";
import { assertExists, mkdirIfMissing, projectRoot, requireValue } from "../cli-shared";
import { appendLogEntry, tailLog } from "../lib/log";
import { fileFingerprint, readCache, writeCache } from "../lib/cache";
import { readText, writeText } from "../lib/fs";
import { gitDiffSummary, readVerificationLevel, resolveRepoPath, assertGitRepo } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { safeMatter } from "../cli-shared";
import { createModuleInternal } from "./project-setup";
import { slugify } from "./planning";
import { collectBacklogFocus } from "./backlog";
import { collectDriftSummary } from "./verification";
import { collectLintResult, collectSemanticLintResult, collectStatusRow, collectVerifySummary, loadLintingSnapshot } from "./linting";
import type { LintingSnapshot } from "./linting";

export async function dashboardProject(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  console.log(JSON.stringify(await collectDashboard(options.project, options.base, options.repo), null, 2));
}

export async function maintainProject(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const result = await collectMaintenancePlan(options.project, options.base, options.repo);
  appendLogEntry("maintain", options.project, { project: options.project, details: [`base=${options.base}`, `actions=${result.actions.length}`] });
  const missingTests = result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length;
  const gateOk = missingTests === 0;
  if (json) console.log(JSON.stringify({ ...result, gate: { ok: gateOk, missingTests } }, null, 2));
  else {
    if (result.focus.activeTask) console.log(`active task: ${result.focus.activeTask.id} ${result.focus.activeTask.title} (plan=${result.focus.activeTask.planStatus} test-plan=${result.focus.activeTask.testPlanStatus})`);
    else if (result.focus.recommendedTask) console.log(`next backlog task: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
    for (const warning of result.focus.warnings) console.log(`- backlog warning: ${warning}`);
    console.log(`maintain plan for ${options.project}:`);
    console.log(`- repo: ${result.repo}`);
    console.log(`- base: ${result.base}`);
    console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
    console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
    console.log(`- uncovered files: ${result.discover.uncoveredFiles.length}`);
    console.log(`- repo docs to move: ${result.discover.repoDocFiles.length}`);
    console.log(`- changed tests: ${result.refreshFromGit.testHealth.changedTestFiles.length}`);
    console.log(`- code changes without changed tests: ${missingTests}`);
    console.log(`- lint issues: ${result.lint.issues.length}`);
    console.log(`- semantic issues: ${result.semanticLint.issues.length}`);
    console.log(`- GATE: ${gateOk ? "PASS" : `FAIL — ${missingTests} code file(s) without tests`}`);
    console.log(`- actions:`);
    for (const action of result.actions) console.log(`  - [${action.kind}] ${action.message}`);
    console.log(`- closeout:`);
    console.log(`  1. run tests`);
    console.log(`  2. wiki refresh-from-git ${options.project} --base ${options.base}`);
    console.log(`  3. wiki drift-check ${options.project} --show-unbound`);
    console.log(`  4. update impacted wiki pages`);
    console.log(`  5. wiki verify-page ${options.project} <page...> <level>`);
    console.log(`  6. wiki lint ${options.project} && wiki lint-semantic ${options.project}`);
    console.log(`  7. wiki gate ${options.project} --repo ${result.repo} --base ${options.base}`);
  }
}

export async function closeoutProject(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectCloseout(options.project, options.base, options.repo);
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderCloseout(result, verbose);
  if (!result.ok) throw new Error(`closeout failed for ${options.project}`);
}

export async function refreshProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const lintingSnapshot = await loadLintingSnapshot(project, { noteIndex: true });
  const drift = await collectDriftSummary(project, repo, lintingSnapshot);
  const lint = await collectLintResult(project, lintingSnapshot);
  appendLogEntry("refresh", project, { project, details: [`stale=${drift.stale}`, `deleted=${drift.deleted}`, `unknown=${drift.unknown}`, `unbound=${drift.unboundPages.length}`, `lint_issues=${lint.issues.length}`] });
  const result = { project, repo: drift.repo, drift: { fresh: drift.fresh, stale: drift.stale, deleted: drift.deleted, unknown: drift.unknown, unbound: drift.unboundPages.length }, lint: { ok: lint.issues.length === 0, issues: lint.issues } };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`refresh summary for ${project}:`);
    console.log(`- repo: ${drift.repo}`);
    console.log(`- drift: fresh=${drift.fresh} stale=${drift.stale} deleted=${drift.deleted} unknown=${drift.unknown} unbound=${drift.unboundPages.length}`);
    console.log(`- lint issues: ${lint.issues.length}`);
    if (drift.stale || drift.deleted || drift.unknown) console.log(`- run: wiki drift-check ${project} --show-unbound`);
    if (lint.issues.length) console.log(`- run: wiki lint ${project}`);
    if (!drift.stale && !drift.deleted && !drift.unknown && !lint.issues.length) console.log(`- docs look current`);
  }
}

export async function refreshFromGit(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const result = await collectRefreshFromGit(options.project, options.base, options.repo);
  appendLogEntry("refresh-from-git", options.project, { project: options.project, details: [`base=${result.base}`, `changed=${result.changedFiles.length}`, `impacted=${result.impactedPages.length}`, `uncovered=${result.uncoveredFiles.length}`, `missing_tests=${result.testHealth.codeFilesWithoutChangedTests.length}`] });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`refresh-from-git for ${options.project}:`);
    console.log(`- repo: ${result.repo}`);
    console.log(`- base: ${result.base}`);
    console.log(`- changed files: ${result.changedFiles.length}`);
    console.log(`- impacted pages: ${result.impactedPages.length}`);
    console.log(`- uncovered files: ${result.uncoveredFiles.length}`);
    console.log(`- changed tests: ${result.testHealth.changedTestFiles.length}`);
    console.log(`- code changes without changed tests: ${result.testHealth.codeFilesWithoutChangedTests.length}`);
    for (const page of result.impactedPages) {
      console.log(`  - ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
      for (const line of page.diffSummary.slice(0, 3)) console.log(`    ${line}`);
    }
    if (result.uncoveredFiles.length) {
      console.log(`- uncovered:`);
      for (const file of result.uncoveredFiles) console.log(`  - ${file}`);
    }
    if (result.testHealth.codeFilesWithoutChangedTests.length) {
      console.log(`- missing test companion changes:`);
      for (const file of result.testHealth.codeFilesWithoutChangedTests) console.log(`  - ${file}`);
    }
  }
}

export async function discoverProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const tree = args.includes("--tree");
  const result = await collectDiscoverSummary(project, repo);
  if (json) console.log(JSON.stringify(tree ? { ...result, tree: buildDirectoryTree(result.uncoveredFiles) } : result, null, 2));
  else if (tree) {
    console.log(`discover --tree for ${project}:`);
    console.log(`- repo files: ${result.repoFiles} | bound: ${result.boundFiles} | uncovered: ${result.uncoveredFiles.length}`);
    console.log(`- unbound pages: ${result.unboundPages.length}`);
    console.log("");
    const groups = buildDirectoryTree(result.uncoveredFiles);
    for (const group of groups) {
      const marker = group.files >= 3 ? "  <- module candidate" : "";
      console.log(`${group.directory}/ (${group.files} files)${marker}`);
    }
    if (result.researchDirs.length) {
      console.log("\nrepo-local research docs detected:");
      for (const dir of result.researchDirs) console.log(`  - ${dir}`);
      console.log("  - file durable findings into wiki research notes; use /research for net-new investigation");
    }
    if (result.unboundPages.length) {
      console.log("\nunbound wiki pages:");
      for (const page of result.unboundPages.slice(0, 15)) console.log(`  - ${page}`);
    }
  } else {
    console.log(`discover for ${project}:`);
    console.log(`- repo files: ${result.repoFiles}`);
    console.log(`- bound files: ${result.boundFiles}`);
    console.log(`- uncovered files: ${result.uncoveredFiles.length}`);
    console.log(`- unbound pages: ${result.unboundPages.length}`);
    console.log(`- placeholder-heavy pages: ${result.placeholderHeavyPages.length}`);
    console.log(`- repo docs to move: ${result.repoDocFiles.length}`);
    for (const file of result.uncoveredFiles.slice(0, 20)) console.log(`  - uncovered: ${file}`);
    for (const file of result.repoDocFiles.slice(0, 20)) console.log(`  - repo-doc: ${file}`);
  }
}

const SCAFFOLD_DIRS = new Set(["src", "lib", "app", "apps", "packages", "services", "workers", "server", "api", "functions", "cmd", "internal"]);

function buildDirectoryTree(files: string[]) {
  // Group files by their "module-level" directory — skip scaffold dirs to find
  // the first meaningful grouping (e.g., apps/api/src/modules/contributions/)
  const groups = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    // Walk past scaffold directories to find the meaningful depth
    let meaningful = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!SCAFFOLD_DIRS.has(parts[i])) meaningful++;
      if (meaningful >= 2) { meaningful = i + 1; break; }
      if (i === parts.length - 2) { meaningful = i + 1; break; }
    }
    const dir = parts.slice(0, meaningful).join("/");
    if (dir) groups.set(dir, (groups.get(dir) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([directory, files]) => ({ directory, files }))
    .sort((a, b) => b.files - a.files);
}

export async function ingestDiff(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const result = await collectIngestDiff(options.project, options.base, options.repo);
  appendLogEntry("ingest-diff", options.project, { project: options.project, details: [`base=${options.base}`, `created=${result.created.length}`, `updated=${result.updated.length}`] });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ingest-diff for ${options.project}:`);
    for (const file of result.created) console.log(`- created ${file}`);
    for (const file of result.updated) console.log(`- updated ${file}`);
  }
}

export type ProjectSnapshot = {
  project: string;
  root: string;
  repo: string;
  pages: string[];
  repoFiles?: string[];
  repoDocFiles?: string[];
  pageEntries: Array<{
    file: string;
    page: string;
    relPath: string;
    vaultPath: string;
    raw: string;
    parsed: ReturnType<typeof safeMatter>;
    sourcePaths: string[];
    rawUpdated: unknown;
    verificationLevel: ReturnType<typeof readVerificationLevel>;
    todoCount: number;
  }>;
};

export async function loadProjectSnapshot(project: string, explicitRepo?: string, options: { includeRepoInventory?: boolean } = {}): Promise<ProjectSnapshot> {
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const repo = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repo);
  const pages = walkMarkdown(root);
  const pageEntries = await Promise.all(pages.map(async (file) => {
    const raw = await readText(file);
    const relPath = relative(root, file).replaceAll("\\", "/");
    const vaultPath = relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/");
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    const sourcePaths = parsed && Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value: unknown) => String(value).replaceAll("\\", "/")) : [];
    return {
      file,
      page: relPath,
      relPath,
      vaultPath,
      raw,
      parsed,
      sourcePaths,
      rawUpdated: parsed?.data.updated,
      verificationLevel: parsed ? readVerificationLevel(parsed.data) : null,
      todoCount: (raw.match(/\bTODO\b/g) ?? []).length,
    };
  }));
  if (!options.includeRepoInventory) return { project, root, repo, pages, pageEntries };
  return {
    project,
    root,
    repo,
    pages,
    repoFiles: listCodeFiles(repo, await readCodePaths(project)),
    repoDocFiles: await listRepoMarkdownDocs(repo),
    pageEntries,
  };
}

export async function collectRefreshFromGit(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo);
  const changedFiles = gitChangedFiles(state.repo, base);
  const changedFileSet = new Set(changedFiles);
  const diffSummaryCache = new Map<string, string[]>();
  const impactedPages: Array<{ page: string; matchedSourcePaths: string[]; verificationLevel: string | null; diffSummary: string[] }> = [];
  const covered = new Set<string>();
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const matchedSourcePaths = entry.sourcePaths.filter((sourcePath) => changedFileSet.has(sourcePath));
    if (!matchedSourcePaths.length) continue;
    for (const sourcePath of matchedSourcePaths) covered.add(sourcePath);
    const diffSummary = matchedSourcePaths.flatMap((sourcePath) => {
      if (!diffSummaryCache.has(sourcePath)) diffSummaryCache.set(sourcePath, gitDiffSummary(state.repo, sourcePath) ?? []);
      return diffSummaryCache.get(sourcePath) ?? [];
    });
    impactedPages.push({ page: entry.page, matchedSourcePaths, verificationLevel: entry.verificationLevel, diffSummary });
  }
  const testHealth = collectChangedTestHealth(changedFiles);
  return { project, repo: state.repo, base, changedFiles, impactedPages, uncoveredFiles: changedFiles.filter((file) => isCodeFile(file) && !covered.has(file)), testHealth };
}

function projectSnapshotToLintingSnapshot(snapshot: ProjectSnapshot, noteIndex?: LintingSnapshot["noteIndex"]): LintingSnapshot {
  return {
    project: snapshot.project,
    root: snapshot.root,
    pages: snapshot.pages,
    noteIndex,
    pageEntries: snapshot.pageEntries.map((entry) => ({
      file: entry.file,
      relPath: entry.relPath,
      vaultPath: entry.vaultPath,
      raw: entry.raw,
      parsed: entry.parsed,
      sourcePaths: entry.sourcePaths,
      rawUpdated: entry.rawUpdated,
      verificationLevel: entry.verificationLevel,
    })),
  };
}

export async function collectCloseout(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot);
  const drift = await collectDriftSummary(project, explicitRepo, lintingState);
  const lint = await collectLintResult(project, lintingState);
  const semanticLint = await collectSemanticLintResult(project, lintingState);
  const impacted = new Set(refreshFromGit.impactedPages.map((page) => page.page));
  const staleImpactedPages = drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  const blockers: string[] = [];
  if (refreshFromGit.testHealth.codeFilesWithoutChangedTests.length > 0) blockers.push(`${refreshFromGit.testHealth.codeFilesWithoutChangedTests.length} changed code file(s) have no matching changed tests`);
  const warnings: string[] = [];
  if (lint.issues.length > 0) warnings.push(`${lint.issues.length} structural lint issue(s)`);
  if (semanticLint.issues.length > 0) warnings.push(`${semanticLint.issues.length} semantic lint issue(s)`);
  if (staleImpactedPages.length > 0) warnings.push(`${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`);
  if (refreshFromGit.uncoveredFiles.length > 0) warnings.push(`${refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings`);
  return {
    project,
    repo: refreshFromGit.repo,
    base,
    ok: blockers.length === 0,
    refreshFromGit,
    drift,
    staleImpactedPages,
    lint,
    semanticLint,
    blockers,
    warnings,
    nextSteps: [
      `update impacted wiki pages from code`,
      `wiki verify-page ${project} <page...> <level>`,
      `re-run wiki closeout ${project} --repo ${refreshFromGit.repo} --base ${base}`,
    ],
  };
}

export async function collectMaintenancePlan(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot);
  const discover = await collectDiscoverSummary(project, explicitRepo, projectSnapshot);
  const lint = await collectLintResult(project, lintingState);
  const semanticLint = await collectSemanticLintResult(project, lintingState);
  const focus = await collectBacklogFocus(project);
  const actions: Array<{ kind: string; message: string }> = [];
  if (focus.activeTask) actions.push({ kind: "active-task", message: `${focus.activeTask.id} ${focus.activeTask.title} (plan=${focus.activeTask.planStatus}, test-plan=${focus.activeTask.testPlanStatus})` });
  else if (focus.recommendedTask) actions.push({ kind: "next-task", message: `${focus.recommendedTask.id} ${focus.recommendedTask.title}` });
  for (const warning of focus.warnings) actions.push({ kind: "backlog-warning", message: warning });
  for (const impacted of refreshFromGit.impactedPages) actions.push({ kind: "review-page", message: `${impacted.page} impacted by ${impacted.matchedSourcePaths.join(", ")}` });
  for (const file of refreshFromGit.uncoveredFiles.slice(0, 20)) actions.push({ kind: "create-or-bind", message: `cover changed file ${file}` });
  for (const file of refreshFromGit.testHealth.codeFilesWithoutChangedTests.slice(0, 20)) actions.push({ kind: "add-tests", message: `changed code without changed tests: ${file}` });
  for (const file of discover.repoDocFiles.slice(0, 20)) actions.push({ kind: "move-doc-to-wiki", message: `repo markdown doc should live in wiki: ${file}` });
  for (const page of discover.unboundPages.slice(0, 20)) actions.push({ kind: "bind-page", message: `${page} has no source_paths` });
  for (const issue of lint.issues.slice(0, 20)) actions.push({ kind: "fix-structure", message: issue });
  for (const issue of semanticLint.issues.slice(0, 20)) actions.push({ kind: "fix-semantic", message: issue });
  return { project, repo: refreshFromGit.repo, base, focus, refreshFromGit, discover, lint, semanticLint, actions };
}

async function collectDashboard(project: string, base: string, explicitRepo?: string) {
  const projectSnapshot = await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingSnapshot = await loadLintingSnapshot(project, { noteIndex: true });
  const maintain = await collectMaintenancePlan(project, base, explicitRepo, projectSnapshot, lintingSnapshot);
  return { project, repo: maintain.repo, base, status: await collectStatusRow(project, lintingSnapshot), verify: await collectVerifySummary(project, lintingSnapshot), drift: await collectDriftSummary(project, explicitRepo, lintingSnapshot), discover: maintain.discover, maintain, recentLog: tailLog(20) };
}

async function collectDiscoverSummary(project: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const boundFiles = new Set<string>();
  const unboundPages: string[] = [];
  const placeholderHeavyPages: string[] = [];
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    if (!entry.sourcePaths.length) unboundPages.push(entry.page);
    for (const sourcePath of entry.sourcePaths) boundFiles.add(sourcePath);
    if (entry.todoCount >= 6) placeholderHeavyPages.push(entry.page);
  }
  // Detect research/docs directories in the repo
  const researchDirs: string[] = [];
  for (const candidate of ["docs/research", "docs", "research", "docs/specs"]) {
    const candidatePath = join(state.repo, candidate);
    if (existsSync(candidatePath)) {
      try {
        const count = [...new Bun.Glob("**/*.md").scanSync({ cwd: candidatePath, onlyFiles: true })].length;
        if (count > 0) researchDirs.push(`${candidate}/ (${count} docs)`);
      } catch {}
    }
  }
  const repoFiles = state.repoFiles ?? listCodeFiles(state.repo, await readCodePaths(project));
  const repoDocFiles = state.repoDocFiles ?? await listRepoMarkdownDocs(state.repo);
  return { project, repo: state.repo, repoFiles: repoFiles.length, boundFiles: boundFiles.size, uncoveredFiles: repoFiles.filter((file) => !boundFiles.has(file)), unboundPages: unboundPages.sort(), placeholderHeavyPages: placeholderHeavyPages.sort(), researchDirs, repoDocFiles };
}

async function collectIngestDiff(project: string, base: string, explicitRepo?: string) {
  const refresh = await collectRefreshFromGit(project, base, explicitRepo);
  const created: string[] = [];
  const updated: string[] = [];
  for (const page of refresh.impactedPages) {
    const pagePath = join(projectRoot(project), page.page);
    const raw = await readText(pagePath);
    const stamp = `\n## Change Digest\n\n- Updated from git diff base \`${base}\`\n${page.matchedSourcePaths.map((source) => `- Source: \`${source}\``).join("\n")}\n`;
    const next = raw.includes("## Change Digest") ? raw.replace(/\n## Change Digest[\s\S]*$/u, stamp.trimEnd() + "\n") : `${raw.trimEnd()}${stamp}`;
    await writeText(pagePath, next);
    updated.push(relative(VAULT_ROOT, pagePath));
  }
  for (const file of refresh.uncoveredFiles) {
    const guessedModule = guessModuleName(file);
    const moduleSpec = join(projectRoot(project), "modules", guessedModule, "spec.md");
    if (existsSync(moduleSpec)) continue;
    mkdirIfMissing(join(projectRoot(project), "modules", guessedModule));
    createModuleInternal(project, guessedModule, [file]);
    created.push(relative(VAULT_ROOT, moduleSpec));
  }
  return { project, repo: refresh.repo, base, created, updated, refresh };
}

function parseProjectRepoBaseArgs(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  return { project, repo, base };
}

export function resolveDefaultBase(project: string, explicitRepo?: string): string {
  // 1. Check _summary.md for default_base
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (existsSync(summaryPath)) {
    const parsed = safeMatter(`projects/${project}/_summary.md`, readFileSync(summaryPath, "utf8"), { silent: true });
    if (parsed?.data.default_base) return String(parsed.data.default_base);
  }
  // 2. Try to detect the default branch from git
  try {
    const repo = resolveRepoPath(project, explicitRepo);
    const proc = Bun.spawnSync(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode === 0) {
      const ref = proc.stdout.toString().trim().replace("refs/remotes/origin/", "");
      if (ref) return ref;
    }
  } catch {}
  // 3. Fall back
  return "HEAD~1";
}

function findProjectArg(args: string[]) {
  return args.find((arg, index) => index === 0 || (!arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--base"));
}

const DEFAULT_CODE_PATTERNS = [
  "src/**/*", "lib/**/*", "app/**/*", "packages/**/*", "services/**/*", "workers/**/*",
  "server/**/*", "api/**/*", "functions/**/*", "components/**/*", "pages/**/*", "routes/**/*",
  "cmd/**/*", "internal/**/*",
];

function listCodeFiles(repo: string, customPaths?: string[]) {
  const patterns = customPaths?.length ? customPaths.map((p) => `${p}/**/*`) : DEFAULT_CODE_PATTERNS;
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const absolute of new Bun.Glob(pattern).scanSync({ cwd: repo, absolute: true, onlyFiles: true })) {
      const rel = relative(repo, absolute).replaceAll("\\", "/");
      if (/\/(node_modules|dist|build|coverage|\.next|__pycache__|\.pytest_cache|\.mypy_cache|\.venv|venv|\.tox)\//u.test(`/${rel}`)) continue;
      if (/^(package-lock\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock)$/u.test(rel.split("/").pop() ?? "")) continue;
      files.add(rel);
    }
  }
  return [...files].sort();
}

async function listRepoMarkdownDocs(repo: string) {
  const fingerprint = `${fileFingerprint(join(repo, ".git", "index"))}:${fileFingerprint(join(repo, ".git", "HEAD"))}:${gitMarkdownStatusFingerprint(repo)}`;
  const cacheKey = `repo-docs:${repo}`;
  const cached = await readCache<string[]>("repo-scan", cacheKey, "2", fingerprint);
  if (cached) return cached;

  const files = new Set<string>();
  const visit = (dir: string, prefix = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === "coverage" || entry.name === ".next") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, rel);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const normalized = rel.replaceAll("\\", "/");
      if (isAllowedRepoMarkdownDoc(normalized)) continue;
      files.add(normalized);
    }
  };
  visit(repo);

  const result = [...files].sort();
  void writeCache("repo-scan", cacheKey, "2", fingerprint, result);
  return result;
}

function isAllowedRepoMarkdownDoc(rel: string) {
  const base = rel.split("/").pop() ?? rel;
  if (/^(README|CHANGELOG|AGENTS|CLAUDE|SETUP)\.md$/iu.test(base)) return true;
  if (/^skills\/[^/]+\/SKILL\.md$/u.test(rel)) return true;
  return false;
}

async function readCodePaths(project: string): Promise<string[] | undefined> {
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (!existsSync(summaryPath)) return undefined;
  const parsed = safeMatter(`projects/${project}/_summary.md`, await readText(summaryPath), { silent: true });
  if (!parsed) return undefined;
  const paths = parsed.data.code_paths;
  return Array.isArray(paths) ? paths.map(String) : undefined;
}

function gitMarkdownStatusFingerprint(repo: string) {
  const proc = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all", "--", "*.md", "**/*.md"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : "status-unavailable";
}

function gitChangedFiles(repo: string, base: string) {
  const proc = Bun.spawnSync(["git", "diff", "--name-only", `${base}...HEAD`], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    if (stderr.includes("ambiguous argument")) throw new Error(`git diff failed for base '${base}'. The revision does not exist yet; pass --base <rev> that exists in this repo.`);
    throw new Error(`git diff failed for base '${base}': ${stderr || "unknown error"}`);
  }
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.replaceAll("\\", "/"));
}

function guessModuleName(file: string) {
  const parts = file.replaceAll("\\", "/").split("/").filter(Boolean);
  const filtered = parts.filter((part) => !["src", "app", "apps", "packages", "services", "workers"].includes(part));
  const candidate = filtered[0] || parts[parts.length - 1] || "module";
  return slugify(candidate.replace(/\.[^.]+$/u, ""));
}

function collectChangedTestHealth(changedFiles: string[]) {
  const changedTestFiles = changedFiles.filter(isTestFile);
  const changedCodeFiles = changedFiles.filter((file) => isCodeFile(file) && !isTestFile(file));
  const changedTestKeys = new Set(changedTestFiles.flatMap(testMatchKeys));
  const codeFilesWithoutChangedTests = changedCodeFiles.filter((file) => !codeMatchKeys(file).some((key) => changedTestKeys.has(key)));
  return {
    changedTestFiles,
    changedCodeFiles,
    codeFilesWithoutChangedTests,
  };
}

export function isTestFile(file: string) {
  return /(^|\/)(tests?|__tests__)\//u.test(file) || /\.(test|spec)\.[^.]+$/u.test(file) || /\/test_[^/]+\.[^.]+$/u.test(file);
}

function renderCloseout(result: Awaited<ReturnType<typeof collectCloseout>>, verbose: boolean) {
  console.log(`closeout for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
  console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
  console.log(`- stale impacted pages: ${result.staleImpactedPages.length}`);
  console.log(`- lint: ${result.lint.issues.length}`);
  console.log(`- semantic: ${result.semanticLint.issues.length}`);
  console.log(`- missing tests: ${result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length}`);
  if (verbose || !result.ok) {
    for (const page of result.refreshFromGit.impactedPages.slice(0, 20)) console.log(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const blocker of result.blockers) console.log(`  - blocker: ${blocker}`);
    for (const warning of result.warnings) console.log(`  - warning: ${warning}`);
  }
  console.log(`- manual steps:`);
  for (const step of result.nextSteps) console.log(`  - ${step}`);
}

function isCodeFile(file: string) {
  return CODE_FILE_PATTERN.test(file);
}

// Normalize file basenames for matching: strip conventional suffixes
// (both dotted like ".service" and hyphenated like "-service") and
// normalize separators so "bank-statement.service" matches "bank-statement-service"
const STRIP_SUFFIXES = "service|handler|handlers|routes|controller|repository|module|middleware|guard|interceptor|pipe|filter|resolver|factory|provider|util|utils|helpers|constants|config|types|dto|entity|model|schema|validator|validators";
const STRIP_DOTTED = new RegExp(`[.](${STRIP_SUFFIXES})$`, "u");
const STRIP_HYPHEN = new RegExp(`-(${STRIP_SUFFIXES})$`, "u");

function normalizeBasename(name: string) {
  return name
    .replace(STRIP_DOTTED, "")
    .replace(STRIP_HYPHEN, "")
    .replaceAll(".", "-")
    .toLowerCase();
}

function codeMatchKeys(file: string) {
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts[parts.length - 1]?.replace(/\.[^.]+$/u, "") ?? normalized;
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const norm = normalizeBasename(basename);
  const keys = new Set<string>();
  // Avoid bare "index" key — too ambiguous, matches any index.test file
  if (norm !== "index") keys.add(norm);
  if (basename.toLowerCase() !== norm && basename.toLowerCase() !== "index") keys.add(basename.toLowerCase());
  const firstSegment = norm.split("-")[0];
  if (firstSegment && firstSegment !== norm && firstSegment !== "index") keys.add(firstSegment);
  if (parent) {
    keys.add(`${parent.toLowerCase()}/${norm}`);
    if (basename.toLowerCase() !== norm) keys.add(`${parent.toLowerCase()}/${basename.toLowerCase()}`);
  }
  if (normalized.startsWith("src/")) keys.add("global-cli");
  return [...keys];
}

function testMatchKeys(file: string) {
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const raw = parts[parts.length - 1]?.replace(/\.[^.]+$/u, "") ?? normalized;
  // Strip test/spec suffixes: .test, .spec (JS/TS) and test_ prefix (Python)
  const basename = raw.replace(/([.-](test|spec))$/u, "").replace(/^test_/u, "");
  const parentCandidates = parts.filter((part) => !/^(tests?|__tests__)$/u.test(part));
  const parent = parentCandidates.length > 1 ? parentCandidates[parentCandidates.length - 2] : "";
  const norm = normalizeBasename(basename);
  const keys = new Set<string>();
  if (norm !== "index") keys.add(norm);
  if (basename.toLowerCase() !== norm && basename.toLowerCase() !== "index") keys.add(basename.toLowerCase());
  if (parent) {
    keys.add(`${parent.toLowerCase()}/${norm}`);
    if (basename.toLowerCase() !== norm) keys.add(`${parent.toLowerCase()}/${basename.toLowerCase()}`);
  }
  if (/(^|\/)(cli-)?smoke\.test\.[^.]+$/u.test(normalized) || /(^|\/)[^/]+\.smoke\.test\.[^.]+$/u.test(normalized)) keys.add("global-cli");
  return [...keys];
}
