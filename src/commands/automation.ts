import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CODE_FILE_PATTERN } from "../constants";
import { fail, requireValue } from "../cli-shared";
import { exists } from "../lib/fs";
import { parseUpdatedDate, resolveRepoPath, assertGitRepo } from "../lib/verification";
import { collectGate } from "./diagnostics";
import { collectRefreshFromGit, loadProjectSnapshot, resolveDefaultBase } from "./maintenance";
import { collectDriftSummary } from "./verification";

export async function commitCheck(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectCommitCheck(options.project, options.repo);
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderCommitCheck(result, verbose);
  if (!result.ok) throw new Error(`commit-check failed for ${options.project}`);
}

export async function installGitHook(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const force = args.includes("--force");
  const hookIndex = args.indexOf("--hook");
  const hook = hookIndex >= 0 ? args[hookIndex + 1] : "pre-commit";
  requireValue(hook, "hook");
  const repo = resolveRepoPath(options.project, options.repo);
  assertGitRepo(repo);
  const hookPath = join(repo, ".git", "hooks", hook);
  if (await exists(hookPath) && !force) throw new Error(`hook already exists: ${hookPath} (use --force to overwrite)`);
  mkdirSync(dirname(hookPath), { recursive: true });
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `REPO=${shellQuote(repo)}`,
    `PROJECT=${shellQuote(options.project)}`,
    'if ! command -v wiki >/dev/null 2>&1; then',
    '  echo "error: wiki CLI not found on PATH" >&2',
    '  exit 1',
    'fi',
    'wiki commit-check "$PROJECT" --repo "$REPO"',
    "",
  ].join("\n");
  writeFileSync(hookPath, script, "utf8");
  chmodSync(hookPath, 0o755);
  const result = { project: options.project, repo, hook, hookPath };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`installed ${hook} hook at ${hookPath}`);
}

export async function refreshOnMerge(args: string[]) {
  const options = parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectRefreshOnMerge(options.project, options.base, options.repo);
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderRefreshOnMerge(result, verbose);
  if (!result.ok) throw new Error(`refresh-on-merge failed for ${options.project}`);
}

export async function checkpoint(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const result = await collectCheckpoint(options.project, options.repo);
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderCheckpoint(result);
  if (!result.clean) fail(`checkpoint found ${result.stalePages.length} stale page(s) for ${options.project}`);
}

export async function lintRepo(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const snapshot = await loadProjectSnapshot(options.project, options.repo, { includeRepoInventory: true });
  const violations = snapshot.repoDocFiles ?? [];
  const result = { project: options.project, repo: snapshot.repo, ok: violations.length === 0, violations };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`lint-repo for ${options.project}: ${result.ok ? "PASS" : "FAIL"}`);
    console.log(`- violations: ${violations.length}`);
    for (const violation of violations.slice(0, 50)) console.log(`  - ${violation}`);
  }
  if (!result.ok) fail(`lint-repo found ${violations.length} disallowed repo markdown file(s) for ${options.project}`);
}

export async function collectCommitCheck(project: string, explicitRepo?: string) {
  const repo = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repo);
  const snapshot = await loadProjectSnapshot(project, repo);
  const stagedFiles = (await gitLines(repo, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"])).map(normalizeRelPath);
  const stagedSet = new Set(stagedFiles);
  const impactedPages: Array<{ page: string; sourcePaths: string[]; staleSources: string[] }> = [];
  const covered = new Set<string>();

  for (const entry of snapshot.pageEntries) {
    if (!entry.parsed) continue;
    const matched = entry.sourcePaths.filter((sourcePath) => stagedSet.has(sourcePath));
    if (!matched.length) continue;
    for (const path of matched) covered.add(path);
    const updated = parseUpdatedDate(entry.rawUpdated);
    const staleSources = matched.filter((sourcePath) => isWorktreeSourceNewer(repo, sourcePath, updated));
    if (staleSources.length) impactedPages.push({ page: entry.page, sourcePaths: matched, staleSources });
  }

  const uncoveredFiles = stagedFiles.filter((file) => isCodeFile(file) && !covered.has(file));
  return {
    project,
    repo,
    ok: impactedPages.length === 0,
    stagedFiles,
    stalePages: impactedPages,
    uncoveredFiles,
  };
}

function renderCommitCheck(result: Awaited<ReturnType<typeof collectCommitCheck>>, verbose: boolean) {
  console.log(`commit-check for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- staged files: ${result.stagedFiles.length}`);
  console.log(`- stale pages: ${result.stalePages.length}`);
  console.log(`- uncovered staged code files: ${result.uncoveredFiles.length}`);
  if (verbose || !result.ok) {
    for (const page of result.stalePages) console.log(`  - stale: ${page.page} <= ${page.staleSources.join(", ")}`);
    for (const file of result.uncoveredFiles.slice(0, 20)) console.log(`  - uncovered: ${file}`);
  }
}

export async function collectCheckpoint(project: string, explicitRepo?: string) {
  const snapshot = await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const summaryEntry = snapshot.pageEntries.find((entry) => entry.relPath === "_summary.md");
  const projectUpdated = parseUpdatedDate(summaryEntry?.rawUpdated) ?? new Date(0);
  const modifiedFiles = new Set<string>();
  const unboundFiles = new Set<string>();
  const pageStatuses = new Map<string, { page: string; matchedSourcePaths: Set<string>; lastSourceChangeMs: number; pageUpdatedMs: number | null; pageUpdated: string }>();

  for (const file of snapshot.repoFiles ?? []) {
    const absolutePath = join(snapshot.repo, file);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(absolutePath).mtimeMs;
    } catch {
      continue;
    }
    const matchedEntries = snapshot.pageEntries.filter((entry) => entry.parsed && entry.sourcePaths.some((sourcePath) => bindingMatchesFile(sourcePath, file)));
    if (mtimeMs > projectUpdated.getTime()) modifiedFiles.add(file);
    if (!matchedEntries.length) {
      if (mtimeMs > projectUpdated.getTime()) unboundFiles.add(file);
      continue;
    }
    for (const entry of matchedEntries) {
      const existing = pageStatuses.get(entry.page) ?? {
        page: entry.page,
        matchedSourcePaths: new Set<string>(),
        lastSourceChangeMs: 0,
        pageUpdatedMs: parseUpdatedDate(entry.rawUpdated)?.getTime() ?? null,
        pageUpdated: String(entry.rawUpdated ?? "missing"),
      };
      existing.matchedSourcePaths.add(file);
      existing.lastSourceChangeMs = Math.max(existing.lastSourceChangeMs, mtimeMs);
      pageStatuses.set(entry.page, existing);
    }
  }

  const orderedPages = [...pageStatuses.values()]
    .map((entry) => ({
      page: entry.page,
      matchedSourcePaths: [...entry.matchedSourcePaths].sort(),
      lastSourceChange: new Date(entry.lastSourceChangeMs).toISOString(),
      pageUpdated: entry.pageUpdated,
      stale: entry.pageUpdatedMs === null || entry.lastSourceChangeMs > entry.pageUpdatedMs,
      modified: entry.lastSourceChangeMs > projectUpdated.getTime(),
    }))
    .filter((entry) => entry.modified || entry.stale)
    .sort((left, right) => left.page.localeCompare(right.page));

  return {
    project,
    repo: snapshot.repo,
    modifiedFiles: modifiedFiles.size,
    boundPages: orderedPages.length,
    pageStatuses: orderedPages,
    stalePages: orderedPages.filter((entry) => entry.stale).map((entry) => ({ page: entry.page, lastSourceChange: entry.lastSourceChange, pageUpdated: entry.pageUpdated })),
    unboundFiles: [...unboundFiles].sort(),
    clean: orderedPages.every((entry) => !entry.stale),
  };
}

function renderCheckpoint(result: Awaited<ReturnType<typeof collectCheckpoint>>) {
  console.log(`Checkpoint: ${result.project}`);
  console.log("");
  console.log(`Modified files: ${result.modifiedFiles}`);
  console.log(`Bound wiki pages: ${result.boundPages}`);
  for (const page of result.pageStatuses) {
    if (page.stale) console.log(`  ✗ ${page.page} — stale (source ${page.lastSourceChange}, page ${page.pageUpdated})`);
    else console.log(`  ✓ ${page.page} — up to date`);
  }
  console.log("");
  console.log(`Unbound files: ${result.unboundFiles.length}`);
  for (const file of result.unboundFiles.slice(0, 50)) console.log(`  ${file}`);
  console.log("");
  console.log(`Result: ${result.clean ? "CLEAN" : `STALE (${result.stalePages.length} page${result.stalePages.length === 1 ? "" : "s"} need update)`}`);
}

type RefreshOnMergeResult = Awaited<ReturnType<typeof collectRefreshOnMerge>>;

function renderRefreshOnMerge(result: RefreshOnMergeResult, verbose: boolean) {
  console.log(`refresh-on-merge for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- repo: ${result.repo}`);
  console.log(`- base: ${result.base}`);
  console.log(`- changed files: ${result.changedFiles.length}`);
  console.log(`- impacted pages: ${result.impactedPages.length}`);
  console.log(`- stale impacted pages: ${result.staleImpactedPages.length}`);
  console.log(`- gate: ${result.gate.ok ? "PASS" : "FAIL"}`);
  if (verbose || !result.ok) {
    for (const page of result.impactedPages.slice(0, 20)) console.log(`  - impacted: ${page.page} <= ${page.matchedSourcePaths.join(", ")}`);
    for (const row of result.staleImpactedPages.slice(0, 20)) console.log(`  - stale: ${row.wikiPage} [${row.status}]`);
    for (const blocker of result.gate.blockers) console.log(`  - blocker: ${blocker}`);
    for (const warning of result.gate.warnings.slice(0, 20)) console.log(`  - warning: ${warning}`);
  }
}

async function collectRefreshOnMerge(project: string, base: string, explicitRepo?: string) {
  const refresh = await collectRefreshFromGit(project, base, explicitRepo);
  const drift = await collectDriftSummary(project, explicitRepo);
  const gate = await collectGate(project, base, explicitRepo);
  const impacted = new Set(refresh.impactedPages.map((page) => page.page));
  const staleImpactedPages = drift.results.filter((row) => impacted.has(row.wikiPage) && row.status !== "fresh");
  return { project, repo: refresh.repo, base, ok: gate.ok && staleImpactedPages.length === 0, changedFiles: refresh.changedFiles, impactedPages: refresh.impactedPages, staleImpactedPages, uncoveredFiles: refresh.uncoveredFiles, gate };
}

function parseProjectRepoArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  if (repoIndex >= 0) requireValue(repo, "repo");
  return { project, repo };
}

function parseProjectRepoBaseArgs(args: string[]) {
  const { project, repo } = parseProjectRepoArgs(args);
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  return { project, repo, base };
}

async function gitLines(repo: string, command: string[]) {
  const proc = await Bun.$`git ${command}`.cwd(repo).nothrow().quiet();
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

function isWorktreeSourceNewer(repo: string, sourcePath: string, updated: Date | null) {
  if (!updated) return true;
  const absolutePath = join(repo, sourcePath);
  try {
    return statSync(absolutePath).mtimeMs > updated.getTime();
  } catch {
    return true;
  }
}

function isCodeFile(file: string) {
  return CODE_FILE_PATTERN.test(file);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
