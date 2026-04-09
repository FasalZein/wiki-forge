import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FrontmatterData } from "../types";
import { safeMatter, projectRoot, assertExists } from "../cli-shared";
import { VERIFICATION_LEVELS, type VerificationLevel } from "../constants";

export function readVerificationLevel(data: FrontmatterData): VerificationLevel | null {
  const value = data.verification_level;
  if (typeof value !== "string") return null;
  if (value === "stale") return value;
  return VERIFICATION_LEVELS.includes(value as (typeof VERIFICATION_LEVELS)[number])
    ? (value as VerificationLevel)
    : null;
}

export function resolveRepoPath(project: string, explicitRepo?: string): string {
  if (explicitRepo) {
    const resolvedExplicit = explicitRepo.startsWith("~") ? join(homedir(), explicitRepo.slice(1)) : resolve(explicitRepo);
    assertExists(resolvedExplicit, `repo path does not exist: ${resolvedExplicit}`);
    return resolvedExplicit;
  }

  const summaryPath = join(projectRoot(project), "_summary.md");
  assertExists(summaryPath, `_summary.md not found for project: ${project}`);

  const raw = readFileSync(summaryPath, "utf8");
  const parsed = safeMatter(summaryPath, raw);
  if (!parsed || !parsed.data.repo) {
    throw new Error(`_summary.md for ${project} is missing the 'repo' frontmatter field. Add 'repo: /absolute/path' or pass --repo <path>.`);
  }

  const repoRaw = String(parsed.data.repo);
  const resolved = repoRaw.startsWith("~") ? join(homedir(), repoRaw.slice(1)) : resolve(repoRaw);
  assertExists(resolved, `repo path does not exist: ${resolved} (from _summary.md repo: ${repoRaw})`);
  return resolved;
}

export function assertGitRepo(repoPath: string) {
  if (!existsSync(join(repoPath, ".git"))) {
    throw new Error(`not a git repository: ${repoPath}`);
  }
}

export function batchGitLastModified(repoPath: string, sourcePaths: string[]): Map<string, Date> {
  const uniquePaths = [...new Set(sourcePaths)].filter(Boolean);
  const results = new Map<string, Date>();
  if (!uniquePaths.length) return results;

  // Separate directory paths (ending with /) from file paths
  const dirPaths = uniquePaths.filter((p) => p.endsWith("/"));
  const filePaths = uniquePaths.filter((p) => !p.endsWith("/"));

  try {
    const proc = Bun.spawnSync(["git", "log", "--format=__DATE__:%aI", "--name-only", "--", ...uniquePaths], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) return results;

    const lines = proc.stdout.toString().replace(/\r\n/g, "\n").split("\n");
    let currentDate: Date | null = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("__DATE__:")) {
        const parsed = new Date(line.slice("__DATE__:".length));
        currentDate = Number.isNaN(parsed.getTime()) ? null : parsed;
        continue;
      }
      if (!currentDate) continue;
      const normalized = line.replaceAll("\\", "/");
      // Direct file match
      if (!results.has(normalized)) results.set(normalized, currentDate);
      // For directory source_paths, attribute the file's date to the directory
      for (const dir of dirPaths) {
        if (normalized.startsWith(dir) && !results.has(dir)) {
          results.set(dir, currentDate);
        }
      }
    }
  } catch {}

  return results;
}

export function sourcePathStatus(repoPath: string, sourcePath: string) {
  const normalizedPath = sourcePath.replaceAll("\\", "/");
  const existsNow = existsSync(join(repoPath, normalizedPath));
  if (existsNow) return { kind: "present" as const };

  const renamedTo = suggestRenamedSourcePath(repoPath, normalizedPath);
  if (renamedTo) return { kind: "renamed" as const, renamedTo };

  try {
    const proc = Bun.spawnSync(["git", "log", "--diff-filter=D", "--summary", "--", normalizedPath], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0 && proc.stdout.toString().trim()) {
      return { kind: "deleted" as const };
    }
  } catch {}

  return { kind: "missing" as const };
}

export function suggestRenamedSourcePath(repoPath: string, sourcePath: string) {
  try {
    const proc = Bun.spawnSync(["git", "log", "--follow", "--name-status", "--format=", "--", sourcePath], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) return null;
    const lines = proc.stdout.toString().replace(/\r\n/g, "\n").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("R")) continue;
      const parts = line.split(/\t+/g).filter(Boolean);
      if (parts.length < 3) continue;
      const [, from, to] = parts;
      if (from.replaceAll("\\", "/") === sourcePath) return to.replaceAll("\\", "/");
    }
  } catch {}
  return null;
}

export function gitDiffSummary(repoPath: string, sourcePath: string, maxLines = 12) {
  try {
    const proc = Bun.spawnSync(["git", "diff", "--stat", "HEAD~1", "HEAD", "--", sourcePath], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) return null;
    const lines = proc.stdout.toString().replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.slice(0, maxLines);
  } catch {}
  return null;
}

export function parseUpdatedDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
