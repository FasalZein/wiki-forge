import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { requireValue } from "../../cli-shared";
import { exists } from "../../lib/fs";
import { parseUpdatedDate, resolveRepoPath, assertGitRepo } from "../../lib/verification";
import { parseProjectRepoArgs, gitLines, normalizeRelPath } from "../../git-utils";
import { loadProjectSnapshot, isWorktreeSourceNewer } from "../shared";
import { isCodeFile } from "../health";
import { printJson, printLine } from "../../lib/cli-output";

export async function commitCheck(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const result = await collectCommitCheck(options.project, options.repo);
  if (json) printJson(result);
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
  const repo = await resolveRepoPath(options.project, options.repo);
  await assertGitRepo(repo);
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
  if (json) printJson(result);
  else printLine(`installed ${hook} hook at ${hookPath}`);
}

export async function collectCommitCheck(project: string, explicitRepo?: string) {
  const repo = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repo);
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
  printLine(`commit-check for ${result.project}: ${result.ok ? "PASS" : "FAIL"}`);
  printLine(`- staged files: ${result.stagedFiles.length}`);
  printLine(`- stale pages: ${result.stalePages.length}`);
  printLine(`- uncovered staged code files: ${result.uncoveredFiles.length}`);
  if (verbose || !result.ok) {
    for (const page of result.stalePages) printLine(`  - stale: ${page.page} <= ${page.staleSources.join(", ")}`);
    for (const file of result.uncoveredFiles.slice(0, 20)) printLine(`  - uncovered: ${file}`);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
