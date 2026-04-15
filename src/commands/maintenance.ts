import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { CODE_FILE_PATTERN, VAULT_ROOT } from "../constants";
import { assertExists, mkdirIfMissing, nowIso, orderFrontmatter, projectRoot, requireValue, writeNormalizedPage } from "../cli-shared";
import { appendLogEntry, tailLog } from "../lib/log";
import { fileFingerprint, readCache, writeCache } from "../lib/cache";
import { exists, readText, writeText } from "../lib/fs";
import { gitDiffSummary, readVerificationLevel, resolveRepoPath, assertGitRepo } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { safeMatter } from "../cli-shared";
import { sliceDocPaths } from "../lib/slices";
import { createModuleInternal } from "./project-setup";
import { slugify } from "./planning";
import { collectBacklog, collectBacklogFocus } from "./backlog";
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
  const worktree = args.includes("--worktree");
  const repairDoneSlices = args.includes("--repair-done-slices");
  const repair = repairDoneSlices ? await repairHistoricalDoneSlices(options.project) : null;
  const result = await collectMaintenancePlan(options.project, options.base, options.repo, undefined, undefined, { worktree });
  appendLogEntry("maintain", options.project, {
    project: options.project,
    details: [worktree ? "mode=worktree" : `base=${options.base}`, `actions=${result.actions.length}`, ...(repair ? [`repaired=${repair.repaired.length}`] : [])],
  });
  const missingTests = result.refreshFromGit.testHealth.codeFilesWithoutChangedTests.length;
  const gateOk = missingTests === 0;
  if (json) console.log(JSON.stringify({ ...result, ...(repair ? { repair } : {}), gate: { ok: gateOk, missingTests } }, null, 2));
  else {
    if (result.focus.activeTask) console.log(`active task: ${result.focus.activeTask.id} ${result.focus.activeTask.title} (plan=${result.focus.activeTask.planStatus} test-plan=${result.focus.activeTask.testPlanStatus})`);
    else if (result.focus.recommendedTask) console.log(`next backlog task: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
    for (const warning of result.focus.warnings) console.log(`- backlog warning: ${warning}`);
    if (repair) {
      console.log(`legacy done-slice repair: repaired=${repair.repaired.length} already_current=${repair.alreadyCurrent} missing_docs=${repair.missingDocs.length}`);
      if (repair.archiveCandidates.length) console.log(`- archive candidates: ${repair.archiveCandidates.map((candidate) => `${candidate.taskId} (${candidate.ageDays}d)`).join(", ")}`);
    }
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
    console.log(worktree
      ? `  2. inspect live worktree changes with wiki maintain ${options.project} --repo ${result.repo} --worktree`
      : `  2. wiki refresh-from-git ${options.project} --base ${options.base}`);
    console.log(`  3. wiki drift-check ${options.project} --show-unbound`);
    console.log(`  4. update impacted wiki pages`);
    console.log(`  5. wiki verify-page ${options.project} <page...> <level>`);
    console.log(`  6. wiki lint ${options.project} && wiki lint-semantic ${options.project}`);
    console.log(worktree
      ? `  7. wiki gate ${options.project} --repo ${result.repo} --worktree`
      : `  7. wiki gate ${options.project} --repo ${result.repo} --base ${options.base}`);
  }
}

export async function closeoutProject(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const worktree = args.includes("--worktree");
  const result = await collectCloseout(options.project, options.base, options.repo, undefined, undefined, { worktree });
  if (json) console.log(JSON.stringify(compactCloseoutForJson(result), null, 2));
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

type DoneSliceRepair = {
  project: string;
  repaired: Array<{ taskId: string; completedAt: string; files: string[]; changes: string[] }>;
  alreadyCurrent: number;
  missingDocs: string[];
  archiveCandidates: Array<{ taskId: string; completedAt: string; ageDays: number }>;
};

type RefreshOptions = {
  worktree?: boolean;
  precomputedRefreshFromGit?: Awaited<ReturnType<typeof collectRefreshFromGit>> | Awaited<ReturnType<typeof collectRefreshFromWorktree>>;
};

type WorktreeImpactedPage = {
  page: string;
  matchedSourcePaths: string[];
  verificationLevel: string | null;
  diffSummary: string[];
  stale: boolean;
  pageUpdated: string;
  lastSourceChange: string;
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
  const changedFiles = await gitChangedFiles(state.repo, base);
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

/** A page under specs/slices/ whose frontmatter status is "done" — historical, not actionable. */
function isHistoricalDoneSlicePage(entry: { page: string; parsed: ReturnType<typeof safeMatter> | null }): boolean {
  if (!entry.parsed) return false;
  if (!/^specs\/slices\/[^/]+\//.test(entry.page)) return false;
  return entry.parsed.data.status === "done";
}

export async function collectRefreshFromWorktree(project: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo);
  const changedFiles = worktreeChangedFiles(state.repo);
  const changedFileSet = new Set(changedFiles);
  const impactedPages: WorktreeImpactedPage[] = [];
  const suppressedPages: WorktreeImpactedPage[] = [];
  const coveredByActionable = new Set<string>();
  const coveredBySuppressed = new Set<string>();
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const matchedSourcePaths = entry.sourcePaths.filter((sourcePath) => [...changedFileSet].some((file) => bindingMatchesFile(sourcePath, file)));
    if (!matchedSourcePaths.length) continue;
    const matchedFiles = changedFiles.filter((candidate) => matchedSourcePaths.some((sourcePath) => bindingMatchesFile(sourcePath, candidate)));
    const suppressed = isHistoricalDoneSlicePage(entry);
    for (const file of matchedFiles) (suppressed ? coveredBySuppressed : coveredByActionable).add(file);
    const pageUpdated = parseEntryUpdated(entry.rawUpdated);
    const lastModified = matchedFiles
      .map((file) => worktreeModifiedAt(state.repo, file))
      .filter((value): value is number => Number.isFinite(value))
      .sort((a, b) => b - a)[0];
    const stale = pageUpdated === null || (typeof lastModified === "number" && lastModified > pageUpdated.getTime());
    const pageData: WorktreeImpactedPage = {
      page: entry.page,
      matchedSourcePaths,
      verificationLevel: entry.verificationLevel,
      diffSummary: matchedFiles.map((file) => `worktree: ${file}`),
      stale,
      pageUpdated: String(entry.rawUpdated ?? "missing"),
      lastSourceChange: typeof lastModified === "number" ? new Date(lastModified).toISOString() : "unknown",
    };
    (suppressed ? suppressedPages : impactedPages).push(pageData);
  }
  // Files covered only by suppressed historical slice pages are effectively uncovered.
  const covered = new Set([...coveredByActionable]);
  const testHealth = collectChangedTestHealth(changedFiles);
  return {
    project,
    repo: state.repo,
    base: "WORKTREE",
    changedFiles,
    impactedPages,
    suppressedPages,
    uncoveredFiles: changedFiles.filter((file) => isCodeFile(file) && !covered.has(file)),
    testHealth,
  };
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

export async function collectCloseout(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.worktree
    ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
    : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot);
  // Run independent checks in parallel — drift, lint, and semantic lint
  // share no mutable state and depend only on the already-loaded snapshots.
  const [drift, lint, semanticLint] = await Promise.all([
    collectDriftSummary(project, explicitRepo, lintingState),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
  ]);
  const impacted = new Set(refreshFromGit.impactedPages.map((page) => page.page));
  const staleImpactedPages = options.worktree
    ? (refreshFromGit.impactedPages as WorktreeImpactedPage[])
      .filter((page) => "stale" in page && page.stale)
      .map((page) => ({ wikiPage: page.page, status: "stale", pageUpdated: page.pageUpdated, lastSourceChange: page.lastSourceChange }))
    : drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  const blockers: string[] = [];
  if (refreshFromGit.testHealth.codeFilesWithoutChangedTests.length > 0) blockers.push(`${refreshFromGit.testHealth.codeFilesWithoutChangedTests.length} changed code file(s) have no matching changed tests`);
  if (options.worktree && staleImpactedPages.length > 0) blockers.push(`${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`);
  const warnings: string[] = [];
  if (lint.issues.length > 0) warnings.push(`${lint.issues.length} structural lint issue(s)`);
  if (semanticLint.issues.length > 0) warnings.push(`${semanticLint.issues.length} semantic lint issue(s)`);
  if (!options.worktree && staleImpactedPages.length > 0) warnings.push(`${staleImpactedPages.length} impacted page(s) are stale or otherwise drifted`);
  if (refreshFromGit.uncoveredFiles.length > 0) warnings.push(`${refreshFromGit.uncoveredFiles.length} changed file(s) are not covered by wiki bindings`);
  const suppressedPages = options.worktree && "suppressedPages" in refreshFromGit ? (refreshFromGit as { suppressedPages: WorktreeImpactedPage[] }).suppressedPages : [];
  if (suppressedPages.length > 0) warnings.push(`${suppressedPages.length} historical done-slice page(s) suppressed from stale check`);
  return {
    project,
    repo: refreshFromGit.repo,
    base: options.worktree ? "WORKTREE" : base,
    ok: blockers.length === 0,
    refreshFromGit,
    drift,
    staleImpactedPages,
    suppressedPages,
    lint,
    semanticLint,
    blockers,
    warnings,
    nextSteps: [
      `update impacted wiki pages from code`,
      `wiki verify-page ${project} <page...> <level>`,
      options.worktree
        ? `re-run wiki closeout ${project} --repo ${refreshFromGit.repo} --worktree`
        : `re-run wiki closeout ${project} --repo ${refreshFromGit.repo} --base ${base}`,
    ],
  };
}

export async function collectMaintenancePlan(project: string, base: string, explicitRepo?: string, snapshot?: ProjectSnapshot, lintingSnapshot?: LintingSnapshot, options: RefreshOptions = {}) {
  const projectSnapshot = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const lintingState = lintingSnapshot ?? projectSnapshotToLintingSnapshot(projectSnapshot);
  const refreshFromGit = options.precomputedRefreshFromGit ?? (
    options.worktree
      ? await collectRefreshFromWorktree(project, explicitRepo, projectSnapshot)
      : await collectRefreshFromGit(project, base, explicitRepo, projectSnapshot)
  );
  // Run independent checks in parallel — discover, lint, semantic lint, and backlog focus
  // share no mutable state and depend only on the already-loaded snapshots.
  const [discover, lint, semanticLint, focus] = await Promise.all([
    collectDiscoverSummary(project, explicitRepo, projectSnapshot),
    collectLintResult(project, lintingState),
    collectSemanticLintResult(project, lintingState),
    collectBacklogFocus(project),
  ]);
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
  return { project, repo: refreshFromGit.repo, base: options.worktree ? "WORKTREE" : base, focus, refreshFromGit, discover, lint, semanticLint, actions };
}

async function repairHistoricalDoneSlices(project: string): Promise<DoneSliceRepair> {
  const backlog = await collectBacklog(project);
  const repairedAt = nowIso();
  const repaired: DoneSliceRepair["repaired"] = [];
  const missingDocs: string[] = [];
  const archiveCandidates: DoneSliceRepair["archiveCandidates"] = [];
  let alreadyCurrent = 0;

  for (const item of backlog.sections["Done"] ?? []) {
    const docs = await readDoneSliceDocs(project, item.id);
    if (!docs.length) {
      missingDocs.push(item.id);
      continue;
    }
    const completedAt = inferHistoricalCompletedAt(docs);
    const changes = collectDoneSliceRepairChanges(docs);
    const archiveCandidate = classifyArchiveCandidate(item.id, completedAt);
    if (archiveCandidate) archiveCandidates.push(archiveCandidate);
    if (!changes.length) {
      alreadyCurrent += 1;
      continue;
    }
    for (const doc of docs) {
      const normalized = normalizeDoneSliceDoc(doc, completedAt, repairedAt);
      writeNormalizedPage(doc.path, doc.content, normalized);
    }
    repaired.push({
      taskId: item.id,
      completedAt,
      files: docs.map((doc) => relative(VAULT_ROOT, doc.path)),
      changes,
    });
    appendLogEntry("repair-done-slice", item.id, {
      project,
      details: [`completed_at=${completedAt}`, `changes=${changes.length}`],
    });
  }

  return { project, repaired, alreadyCurrent, missingDocs, archiveCandidates };
}

async function collectDashboard(project: string, base: string, explicitRepo?: string) {
  const [projectSnapshot, lintingSnapshot] = await Promise.all([
    loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true }),
    loadLintingSnapshot(project, { noteIndex: true }),
  ]);
  const maintain = await collectMaintenancePlan(project, base, explicitRepo, projectSnapshot, lintingSnapshot);
  const [status, verify, drift] = await Promise.all([
    collectStatusRow(project, lintingSnapshot),
    collectVerifySummary(project, lintingSnapshot),
    collectDriftSummary(project, explicitRepo, lintingSnapshot),
  ]);
  return { project, repo: maintain.repo, base, status, verify, drift, discover: maintain.discover, maintain, recentLog: tailLog(20) };
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
    if (await exists(candidatePath)) {
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
    if (await exists(moduleSpec)) continue;
    mkdirIfMissing(join(projectRoot(project), "modules", guessedModule));
    await createModuleInternal(project, guessedModule, [file]);
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

// TODO(WIKI-FORGE-069): keep sync — 7+ callers via parseProjectRepoBaseArgs are sync
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
    // TODO: migrate to Bun.$ when caller chain is async (resolveDefaultBase is sync-exported)
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
  const fingerprint = `${fileFingerprint(join(repo, ".git", "index"))}:${fileFingerprint(join(repo, ".git", "HEAD"))}:${await gitMarkdownStatusFingerprint(repo)}`;
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
  if (!await exists(summaryPath)) return undefined;
  const parsed = safeMatter(`projects/${project}/_summary.md`, await readText(summaryPath), { silent: true });
  if (!parsed) return undefined;
  const paths = parsed.data.code_paths;
  return Array.isArray(paths) ? paths.map(String) : undefined;
}

async function gitMarkdownStatusFingerprint(repo: string) {
  const proc = await Bun.$`git status --porcelain --untracked-files=all -- *.md **/*.md`.cwd(repo).nothrow().quiet();
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : "status-unavailable";
}

async function readDoneSliceDocs(project: string, taskId: string) {
  const paths = sliceDocPaths(project, taskId);
  const docs: Array<{ path: string; content: string; data: Record<string, unknown>; kind: "index" | "plan" | "test-plan" }> = [];
  for (const [kind, path] of [
    ["index", paths.indexPath],
    ["plan", paths.planPath],
    ["test-plan", paths.testPlanPath],
  ] as const) {
    if (!await exists(path)) continue;
    const raw = await readText(path);
    const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
    if (!parsed) continue;
    docs.push({ path, content: parsed.content, data: parsed.data, kind });
  }
  return docs;
}

function inferHistoricalCompletedAt(docs: Array<{ data: Record<string, unknown> }>) {
  for (const key of ["completed_at", "updated", "started_at", "created_at"] as const) {
    const timestamps = docs.flatMap((doc) => [doc.data[key]])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));
    if (timestamps.length) return new Date(Math.max(...timestamps)).toISOString();
  }
  return nowIso();
}

function collectDoneSliceRepairChanges(docs: Array<{ data: Record<string, unknown>; kind: "index" | "plan" | "test-plan" }>) {
  const changes = new Set<string>();
  for (const doc of docs) {
    if (doc.data.status !== "done") changes.add("set status: done");
    if (typeof doc.data.completed_at !== "string" || !doc.data.completed_at.trim()) changes.add("set completed_at");
    if (doc.data.claimed_by || doc.data.claimed_at || doc.data.claim_paths) changes.add("clear claim metadata");
    if (!readVerificationLevel(doc.data)) {
      changes.add(doc.kind === "test-plan" ? "set verification_level: test-verified" : "set verification_level: code-verified");
    }
  }
  return [...changes];
}

function normalizeDoneSliceDoc(
  doc: { data: Record<string, unknown>; kind: "index" | "plan" | "test-plan" },
  completedAt: string,
  repairedAt: string,
) {
  const next = { ...doc.data } as Record<string, unknown>;
  next.status = "done";
  next.completed_at = typeof next.completed_at === "string" && next.completed_at.trim() ? next.completed_at : completedAt;
  next.updated = repairedAt;
  if (!readVerificationLevel(next)) next.verification_level = doc.kind === "test-plan" ? "test-verified" : "code-verified";
  delete next.claimed_by;
  delete next.claimed_at;
  delete next.claim_paths;
  return orderFrontmatter(next, ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "started_at", "updated", "completed_at", "status", "verification_level"]);
}

function classifyArchiveCandidate(taskId: string, completedAt: string) {
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs)) return null;
  const ageDays = Math.floor((Date.now() - completedMs) / (1000 * 60 * 60 * 24));
  if (ageDays < 30) return null;
  return { taskId, completedAt, ageDays };
}

async function gitChangedFiles(repo: string, base: string) {
  const proc = await Bun.$`git diff --name-only ${base}...HEAD`.cwd(repo).nothrow().quiet();
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

/** Strip fresh drift rows and absolute paths from closeout JSON to reduce token consumption. */
function compactCloseoutForJson(result: Awaited<ReturnType<typeof collectCloseout>>) {
  const MAX_DRIFT_ROWS = 30;
  const driftedRows = result.drift.results.filter((row) => row.status !== "fresh");
  const truncatedDrift = driftedRows.length > MAX_DRIFT_ROWS;
  return {
    ...result,
    drift: {
      ...result.drift,
      results: driftedRows.slice(0, MAX_DRIFT_ROWS).map(({ absolutePath, ...row }) => row),
      ...(truncatedDrift ? { truncated: true, totalDrifted: driftedRows.length } : {}),
    },
  };
}

function renderCloseout(result: Awaited<ReturnType<typeof collectCloseout>>, verbose: boolean) {
  console.log(`closeout for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  console.log(`- changed files: ${result.refreshFromGit.changedFiles.length}`);
  console.log(`- impacted pages: ${result.refreshFromGit.impactedPages.length}`);
  console.log(`- stale impacted pages: ${result.staleImpactedPages.length}`);
  if (result.suppressedPages.length) console.log(`- suppressed historical done-slice pages: ${result.suppressedPages.length}`);
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

function gitLines(repo: string, command: string[]) {
  // TODO: migrate to Bun.$ when caller chain is async (worktreeChangedFiles is sync, cascades from gitLines)
  const proc = Bun.spawnSync(["git", ...command], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString().trim() || `git ${command.join(" ")} failed`);
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function normalizeRelPath(value: string) {
  return value.replaceAll("\\", "/");
}

function bindingMatchesFile(binding: string, file: string) {
  const normalizedBinding = normalizeRelPath(binding).replace(/\/+$/u, "");
  const normalizedFile = normalizeRelPath(file);
  return normalizedFile === normalizedBinding || normalizedFile.startsWith(`${normalizedBinding}/`);
}

function worktreeChangedFiles(repo: string) {
  const changed = new Set<string>(gitLines(repo, ["diff", "--name-only", "HEAD", "--"]).map(normalizeRelPath));
  for (const file of gitLines(repo, ["ls-files", "--others", "--exclude-standard"]).map(normalizeRelPath)) changed.add(file);
  return [...changed].sort();
}

function worktreeModifiedAt(repo: string, file: string) {
  try {
    return Bun.file(join(repo, file)).lastModified;
  } catch {
    return Number.NaN;
  }
}

function parseEntryUpdated(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
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
