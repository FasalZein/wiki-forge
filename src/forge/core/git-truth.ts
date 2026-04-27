import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertGitRepo } from "../../lib/verification";

export type GitStatusKind = "staged" | "unstaged" | "untracked" | "deleted" | "renamed";

export type GitRenamedFile = {
  from: string;
  to: string;
};

export type GitTruth = {
  repo: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  deleted: string[];
  renamed: GitRenamedFile[];
  changedFiles: string[];
  counts: Record<GitStatusKind, number>;
  fingerprint: string;
};

export async function collectGitTruth(repo: string): Promise<GitTruth> {
  await assertGitRepo(repo);
  const proc = await Bun.$`git status --porcelain=v1 --untracked-files=all`.cwd(repo).quiet().nothrow();
  if (proc.exitCode !== 0) throw new Error(`git status failed for ${repo}: ${proc.stderr.toString().trim()}`);

  const staged = new Set<string>();
  const unstaged = new Set<string>();
  const untracked = new Set<string>();
  const deleted = new Set<string>();
  const renamed: GitRenamedFile[] = [];

  for (const rawLine of proc.text().replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine.trim()) continue;
    const indexStatus = rawLine[0] ?? " ";
    const worktreeStatus = rawLine[1] ?? " ";
    const rawPath = rawLine.slice(3).trim();
    if (!rawPath) continue;

    if (indexStatus === "?" && worktreeStatus === "?") {
      untracked.add(normalizeGitStatusPath(rawPath));
      continue;
    }

    if (indexStatus === "R" || indexStatus === "C") {
      const parsed = parseRename(rawPath);
      renamed.push(parsed);
      staged.add(parsed.to);
      if (worktreeStatus !== " ") unstaged.add(parsed.to);
      continue;
    }

    const file = normalizeGitStatusPath(rawPath);
    if (indexStatus !== " " && indexStatus !== "?") staged.add(file);
    if (worktreeStatus !== " " && worktreeStatus !== "?") unstaged.add(file);
    if (indexStatus === "D" || worktreeStatus === "D") deleted.add(file);
  }

  const truth = buildGitTruth(repo, {
    staged: [...staged].sort(),
    unstaged: [...unstaged].sort(),
    untracked: [...untracked].sort(),
    deleted: [...deleted].sort(),
    renamed: renamed.sort((left, right) => left.to.localeCompare(right.to)),
  });
  return truth;
}

export async function collectGitInputFingerprint(repo: string): Promise<string> {
  await assertGitRepo(repo);
  const hash = createHash("sha256");
  hash.update(`HEAD\n${await gitText(repo, ["rev-parse", "--verify", "HEAD"], "unborn")}\n`);
  hash.update(`STATUS\n${await gitText(repo, ["status", "--porcelain=v1", "--untracked-files=all"], "")}\n`);
  hash.update(`DIFF\n${await gitText(repo, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], "")}\n`);
  hash.update(`STAGED\n${await gitText(repo, ["diff", "--cached", "--binary", "--no-ext-diff", "HEAD", "--"], "")}\n`);
  const untrackedFiles = await gitText(repo, ["ls-files", "--others", "--exclude-standard", "-z"], "");
  for (const file of untrackedFiles.split("\0").filter(Boolean).sort()) {
    hash.update(`UNTRACKED:${file}\n`);
    try {
      const bytes = await Bun.file(join(repo, file)).arrayBuffer();
      hash.update(new Uint8Array(bytes));
      hash.update("\n");
    } catch {
      hash.update("unreadable\n");
    }
  }
  return hash.digest("hex");
}

export function formatGitTruthSummary(truth: GitTruth) {
  if (truth.clean) return "clean";
  const parts: string[] = [];
  if (truth.counts.staged) parts.push(`${truth.counts.staged} staged`);
  if (truth.counts.unstaged) parts.push(`${truth.counts.unstaged} unstaged`);
  if (truth.counts.untracked) parts.push(`${truth.counts.untracked} untracked`);
  if (truth.counts.deleted) parts.push(`${truth.counts.deleted} deleted`);
  if (truth.counts.renamed) parts.push(`${truth.counts.renamed} renamed`);
  return parts.join(", ") || "dirty";
}

function buildGitTruth(repo: string, input: Pick<GitTruth, "staged" | "unstaged" | "untracked" | "deleted" | "renamed">): GitTruth {
  const changedFiles = [...new Set([
    ...input.staged,
    ...input.unstaged,
    ...input.untracked,
    ...input.deleted,
    ...input.renamed.flatMap((entry) => [entry.from, entry.to]),
  ])].sort();
  const counts: Record<GitStatusKind, number> = {
    staged: input.staged.length,
    unstaged: input.unstaged.length,
    untracked: input.untracked.length,
    deleted: input.deleted.length,
    renamed: input.renamed.length,
  };
  const fingerprint = [
    ...input.staged.map((file) => `S:${file}`),
    ...input.unstaged.map((file) => `M:${file}`),
    ...input.untracked.map((file) => `?:${file}`),
    ...input.deleted.map((file) => `D:${file}`),
    ...input.renamed.map((entry) => `R:${entry.from}->${entry.to}`),
  ].sort().join("\n");
  return {
    repo,
    clean: changedFiles.length === 0,
    staged: input.staged,
    unstaged: input.unstaged,
    untracked: input.untracked,
    deleted: input.deleted,
    renamed: input.renamed,
    changedFiles,
    counts,
    fingerprint,
  };
}

async function gitText(repo: string, args: string[], fallback: string): Promise<string> {
  const proc = await Bun.$`git ${args}`.cwd(repo).quiet().nothrow();
  if (proc.exitCode !== 0) return fallback;
  return proc.stdout.toString().replace(/\r\n/g, "\n").trimEnd();
}

function parseRename(rawPath: string): GitRenamedFile {
  const separator = " -> ";
  const index = rawPath.indexOf(separator);
  if (index < 0) {
    const normalized = normalizeGitStatusPath(rawPath);
    return { from: normalized, to: normalized };
  }
  return {
    from: normalizeGitStatusPath(rawPath.slice(0, index)),
    to: normalizeGitStatusPath(rawPath.slice(index + separator.length)),
  };
}

function normalizeGitStatusPath(value: string) {
  const trimmed = value.trim();
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\"/gu, '"')
    : trimmed;
  return unquoted.replaceAll("\\", "/");
}
