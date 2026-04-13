import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { VAULT_ROOT } from "../constants";
import { assertExists, projectRoot, requireValue, safeMatter } from "../cli-shared";
import { readText } from "../lib/fs";
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
  if (existsSync(hookPath) && !force) throw new Error(`hook already exists: ${hookPath} (use --force to overwrite)`);
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
  const refresh = await collectRefreshFromGit(options.project, options.base, options.repo);
  const drift = await collectDriftSummary(options.project, options.repo);
  const gate = await collectGate(options.project, options.base, options.repo);
  const impacted = new Set(refresh.impactedPages.map((page) => page.page));
  const impactedDrift = drift.results.filter((row) => impacted.has(row.wikiPage));
  const staleImpacted = impactedDrift.filter((row) => row.status !== "fresh");
  const result = {
    project: options.project,
    repo: refresh.repo,
    base: options.base,
    ok: gate.ok && staleImpacted.length === 0,
    changedFiles: refresh.changedFiles,
    impactedPages: refresh.impactedPages,
    staleImpactedPages: staleImpacted,
    uncoveredFiles: refresh.uncoveredFiles,
    gate,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderRefreshOnMerge(result, verbose);
  if (!result.ok) throw new Error(`refresh-on-merge failed for ${options.project}`);
}

export async function collectCommitCheck(project: string, explicitRepo?: string) {
  const repo = resolveRepoPath(project, explicitRepo);
  assertGitRepo(repo);
  const snapshot = await loadProjectSnapshot(project, repo);
  const stagedFiles = gitLines(repo, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).map(normalizeRelPath);
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

function renderRefreshOnMerge(result: Awaited<ReturnType<typeof buildRefreshOnMergeShape>>, verbose: boolean) {
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

type RefreshOnMergeShape = Awaited<ReturnType<typeof buildRefreshOnMergeShape>>;

async function buildRefreshOnMergeShape(project: string, base: string, explicitRepo?: string) {
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

function gitLines(repo: string, command: string[]) {
  const proc = Bun.spawnSync(["git", ...command], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString().trim() || `git ${command.join(" ")} failed`);
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function normalizeRelPath(value: string) {
  return value.replaceAll("\\", "/");
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
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift)$/u.test(file);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
