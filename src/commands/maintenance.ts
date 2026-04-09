import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, mkdirIfMissing, projectRoot, requireValue } from "../cli-shared";
import { appendLogEntry, tailLog } from "../lib/log";
import { fileFingerprint, readCache, writeCache } from "../lib/cache";
import { readText, writeText } from "../lib/fs";
import { gitDiffSummary, readVerificationLevel, resolveRepoPath, assertGitRepo } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { safeMatter } from "../cli-shared";
import { createModuleInternal } from "./project-setup";
import { slugify } from "./planning";
import { collectDriftSummary } from "./verification";
import { collectLintResult, collectSemanticLintResult, collectStatusRow, collectVerifySummary } from "./linting";

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
  }
}

export async function refreshProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const drift = await collectDriftSummary(project, repo);
  const lint = await collectLintResult(project);
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
      console.log("\nresearch layer detected:");
      for (const dir of result.researchDirs) console.log(`  - ${dir}`);
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

export async function collectRefreshFromGit(project: string, base: string, explicitRepo?: string) {
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const repo = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repo);
  const changedFiles = gitChangedFiles(repo, base);
  const pages = walkMarkdown(root);
  const impactedPages: Array<{ page: string; matchedSourcePaths: string[]; verificationLevel: string | null; diffSummary: string[] }> = [];
  const covered = new Set<string>();
  for (const file of pages) {
    const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
    if (!parsed) continue;
    const sourcePaths = Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value: unknown) => String(value).replaceAll("\\", "/")) : [];
    const matchedSourcePaths = sourcePaths.filter((sourcePath: string) => changedFiles.includes(sourcePath));
    if (!matchedSourcePaths.length) continue;
    for (const sourcePath of matchedSourcePaths) covered.add(sourcePath);
    impactedPages.push({ page: relative(root, file), matchedSourcePaths, verificationLevel: readVerificationLevel(parsed.data), diffSummary: matchedSourcePaths.flatMap((sourcePath: string) => gitDiffSummary(repo, sourcePath) ?? []) });
  }
  const testHealth = collectChangedTestHealth(changedFiles);
  return { project, repo, base, changedFiles, impactedPages, uncoveredFiles: changedFiles.filter((file) => isCodeFile(file) && !covered.has(file)), testHealth };
}

export async function collectMaintenancePlan(project: string, base: string, explicitRepo?: string) {
  const refreshFromGit = await collectRefreshFromGit(project, base, explicitRepo);
  const discover = await collectDiscoverSummary(project, explicitRepo);
  const lint = await collectLintResult(project);
  const semanticLint = await collectSemanticLintResult(project);
  const actions: Array<{ kind: string; message: string }> = [];
  for (const impacted of refreshFromGit.impactedPages) actions.push({ kind: "review-page", message: `${impacted.page} impacted by ${impacted.matchedSourcePaths.join(", ")}` });
  for (const file of refreshFromGit.uncoveredFiles.slice(0, 20)) actions.push({ kind: "create-or-bind", message: `cover changed file ${file}` });
  for (const file of refreshFromGit.testHealth.codeFilesWithoutChangedTests.slice(0, 20)) actions.push({ kind: "add-tests", message: `changed code without changed tests: ${file}` });
  for (const file of discover.repoDocFiles.slice(0, 20)) actions.push({ kind: "move-doc-to-wiki", message: `repo markdown doc should live in wiki: ${file}` });
  for (const page of discover.unboundPages.slice(0, 20)) actions.push({ kind: "bind-page", message: `${page} has no source_paths` });
  for (const issue of lint.issues.slice(0, 20)) actions.push({ kind: "fix-structure", message: issue });
  for (const issue of semanticLint.issues.slice(0, 20)) actions.push({ kind: "fix-semantic", message: issue });
  return { project, repo: refreshFromGit.repo, base, refreshFromGit, discover, lint, semanticLint, actions };
}

async function collectDashboard(project: string, base: string, explicitRepo?: string) {
  const maintain = await collectMaintenancePlan(project, base, explicitRepo);
  return { project, repo: maintain.repo, base, status: await collectStatusRow(project), verify: await collectVerifySummary(project), drift: await collectDriftSummary(project, explicitRepo), discover: maintain.discover, maintain, recentLog: tailLog(20) };
}

async function collectDiscoverSummary(project: string, explicitRepo?: string) {
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const repo = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repo);
  const repoFiles = listCodeFiles(repo, await readCodePaths(project));
  const pages = walkMarkdown(root);
  const boundFiles = new Set<string>();
  const unboundPages: string[] = [];
  const placeholderHeavyPages: string[] = [];
  for (const file of pages) {
    const raw = await readText(file);
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    if (!parsed) continue;
    const sourcePaths = Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value) => String(value).replaceAll("\\", "/")) : [];
    if (!sourcePaths.length) unboundPages.push(relative(root, file));
    for (const sourcePath of sourcePaths) boundFiles.add(sourcePath);
    const todoCount = (raw.match(/\bTODO\b/g) ?? []).length;
    if (todoCount >= 6) placeholderHeavyPages.push(relative(root, file));
  }
  // Detect research/docs directories in the repo
  const researchDirs: string[] = [];
  for (const candidate of ["docs/research", "docs", "research", "docs/specs"]) {
    const candidatePath = join(repo, candidate);
    if (existsSync(candidatePath)) {
      try {
        const count = [...new Bun.Glob("**/*.md").scanSync({ cwd: candidatePath, onlyFiles: true })].length;
        if (count > 0) researchDirs.push(`${candidate}/ (${count} docs)`);
      } catch {}
    }
  }
  const repoDocFiles = await listRepoMarkdownDocs(repo);
  return { project, repo, repoFiles: repoFiles.length, boundFiles: boundFiles.size, uncoveredFiles: repoFiles.filter((file) => !boundFiles.has(file)), unboundPages: unboundPages.sort(), placeholderHeavyPages: placeholderHeavyPages.sort(), researchDirs, repoDocFiles };
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
  const fingerprint = `${fileFingerprint(join(repo, ".git", "index"))}:${fileFingerprint(join(repo, ".git", "HEAD"))}`;
  const cacheKey = `repo-docs:${repo}`;
  const cached = await readCache<string[]>("repo-scan", cacheKey, "1", fingerprint);
  if (cached) return cached;

  const files = new Set<string>();
  for (const absolute of new Bun.Glob("**/*.md").scanSync({ cwd: repo, absolute: true, onlyFiles: true })) {
    const rel = relative(repo, absolute).replaceAll("\\", "/");
    if (/\/(node_modules|dist|build|coverage|\.next|\.git)\//u.test(`/${rel}`)) continue;
    const base = rel.split("/").pop() ?? rel;
    if (/^(README|CHANGELOG)\.md$/iu.test(base)) continue;
    files.add(rel);
  }
  const result = [...files].sort();
  void writeCache("repo-scan", cacheKey, "1", fingerprint, result);
  return result;
}

async function readCodePaths(project: string): Promise<string[] | undefined> {
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (!existsSync(summaryPath)) return undefined;
  const parsed = safeMatter(`projects/${project}/_summary.md`, await readText(summaryPath), { silent: true });
  if (!parsed) return undefined;
  const paths = parsed.data.code_paths;
  return Array.isArray(paths) ? paths.map(String) : undefined;
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

function isTestFile(file: string) {
  return /(^|\/)(tests?|__tests__)\//u.test(file) || /\.(test|spec)\.[^.]+$/u.test(file) || /\/test_[^/]+\.[^.]+$/u.test(file);
}

function isCodeFile(file: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift)$/.test(file);
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
