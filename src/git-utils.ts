import { join } from "node:path";
import { projectRoot, requireValue, safeMatter } from "./cli-shared";
import { exists, readText } from "./lib/fs";
import { resolveRepoPath } from "./lib/verification";

export type ProjectRepoArgs = {
  project: string;
  repo?: string;
};

export type ProjectRepoBaseArgs = {
  project: string;
  repo?: string;
  base: string;
  baseFallbackNote?: string;
};

type ParseProjectRepoBaseOptions = {
  fallbackToHeadIfUnresolvable?: boolean;
  fallbackLabel?: string;
};

export async function resolveDefaultBase(project: string, explicitRepo?: string): Promise<string> {
  // 1. Check _summary.md for default_base
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (await exists(summaryPath)) {
    const parsed = safeMatter(`projects/${project}/_summary.md`, await readText(summaryPath), { silent: true });
    if (parsed?.data.default_base) return String(parsed.data.default_base);
  }
  // 2. Try to detect the default branch from git
  try {
    const repo = await resolveRepoPath(project, explicitRepo);
    const proc = await Bun.$`git symbolic-ref refs/remotes/origin/HEAD`.cwd(repo).quiet().nothrow();
    if (proc.exitCode === 0) {
      const ref = proc.text().trim().replace("refs/remotes/origin/", "");
      if (ref) return ref;
    }
  } catch {}
  // 3. Fall back
  return "HEAD~1";
}

async function gitRevisionExists(repo: string, rev: string) {
  const proc = await Bun.$`git rev-parse --verify ${rev}`.cwd(repo).quiet().nothrow();
  return proc.exitCode === 0;
}

export function findProjectArg(args: string[]): string | undefined {
  return args.find((arg, index) => index === 0 || (!arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--base"));
}

export function parseProjectRepoArgs(args: string[]): ProjectRepoArgs {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  if (repoIndex >= 0) requireValue(repo, "repo");
  return { project, repo };
}

export async function parseProjectRepoBaseArgs(args: string[], options: ParseProjectRepoBaseOptions = {}): Promise<ProjectRepoBaseArgs> {
  const { project, repo } = parseProjectRepoArgs(args);
  const baseIndex = args.indexOf("--base");
  let base = baseIndex >= 0 ? args[baseIndex + 1] : await resolveDefaultBase(project, repo);
  if (baseIndex >= 0) requireValue(base, "base");
  let baseFallbackNote: string | undefined;
  if (
    baseIndex < 0
    && options.fallbackToHeadIfUnresolvable
    && base === "HEAD~1"
  ) {
    const resolvedRepo = await resolveRepoPath(project, repo);
    if (!await gitRevisionExists(resolvedRepo, "HEAD~1")) {
      base = "HEAD";
      baseFallbackNote = `${options.fallbackLabel ?? "command"}: HEAD~1 unresolvable, falling back to HEAD`;
    }
  }
  return { project, repo, base, ...(baseFallbackNote ? { baseFallbackNote } : {}) };
}

export async function gitChangedFiles(repo: string, base: string) {
  const proc = await Bun.$`git diff --name-only ${base}...HEAD`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    if (stderr.includes("ambiguous argument")) throw new Error(`git diff failed for base '${base}'. The revision does not exist yet; pass --base <rev> that exists in this repo.`);
    throw new Error(`git diff failed for base '${base}': ${stderr || "unknown error"}`);
  }
  return proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.replaceAll("\\", "/"));
}

/**
 * Return the SHA of the most recent commit that touched `filePath`, or null
 * if the file has no git history (new/untracked). Used for verified_against
 * acknowledgement checks (WIKI-FORGE-104).
 */
export async function gitLastShaForPath(repo: string, filePath: string): Promise<string | null> {
  const proc = await Bun.$`git log -1 --format=%H -- ${filePath}`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) return null;
  const sha = proc.stdout.toString().trim();
  return sha || null;
}

/** Return the current HEAD SHA of the repo. */
export async function gitHeadSha(repo: string): Promise<string> {
  const proc = await Bun.$`git rev-parse HEAD`.cwd(repo).nothrow().quiet();
  if (proc.exitCode !== 0) throw new Error(`git rev-parse HEAD failed: ${proc.stderr.toString().trim()}`);
  return proc.stdout.toString().trim();
}

export async function gitLines(repo: string, command: string[]) {
  const proc = await Bun.$`git ${command}`.cwd(repo).quiet().nothrow();
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString().trim() || `git ${command.join(" ")} failed`);
  return proc.text().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

export function normalizeRelPath(value: string) {
  return value.replaceAll("\\", "/");
}

export function bindingMatchesFile(binding: string, file: string) {
  const normalizedBinding = normalizeRelPath(binding).replace(/\/+$/u, "");
  const normalizedFile = normalizeRelPath(file);
  return normalizedFile === normalizedBinding || normalizedFile.startsWith(`${normalizedBinding}/`);
}

export async function worktreeChangedFiles(repo: string) {
  const changed = new Set<string>((await gitLines(repo, ["diff", "--name-only", "HEAD", "--"])).map(normalizeRelPath));
  for (const file of (await gitLines(repo, ["ls-files", "--others", "--exclude-standard"])).map(normalizeRelPath)) changed.add(file);
  return [...changed].sort();
}

export function worktreeModifiedAt(repo: string, file: string) {
  try {
    return Bun.file(join(repo, file)).lastModified;
  } catch {
    return Number.NaN;
  }
}

export function parseEntryUpdated(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export async function gitMarkdownStatusFingerprint(repo: string) {
  const proc = await Bun.$`git status --porcelain --untracked-files=all -- *.md **/*.md`.cwd(repo).nothrow().quiet();
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : "status-unavailable";
}
