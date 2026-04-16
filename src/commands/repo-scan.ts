import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { projectRoot } from "../cli-shared";
import { safeMatter } from "../cli-shared";
import { fileFingerprint, readCache, writeCache } from "../lib/cache";
import { exists, readText } from "../lib/fs";
import { gitMarkdownStatusFingerprint } from "./git-utils";

export const SCAFFOLD_DIRS = new Set(["src", "lib", "app", "apps", "packages", "services", "workers", "server", "api", "functions", "cmd", "internal"]);

export const DEFAULT_CODE_PATTERNS = [
  "src/**/*", "lib/**/*", "app/**/*", "packages/**/*", "services/**/*", "workers/**/*",
  "server/**/*", "api/**/*", "functions/**/*", "components/**/*", "pages/**/*", "routes/**/*",
  "cmd/**/*", "internal/**/*",
];

export function listCodeFiles(repo: string, customPaths?: string[]) {
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

export async function listRepoMarkdownDocs(repo: string) {
  const fingerprint = `${fileFingerprint(join(repo, ".git", "index"))}:${fileFingerprint(join(repo, ".git", "HEAD"))}:${await gitMarkdownStatusFingerprint(repo)}`;
  const cacheKey = `repo-docs:${repo}`;
  const cached = await readCache<string[]>("repo-scan", cacheKey, "2", fingerprint);
  if (cached) return cached;

  const files = new Set<string>();
  const visit = (dir: string, prefix = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".claude" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === "coverage" || entry.name === ".next") continue;
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

export function isAllowedRepoMarkdownDoc(rel: string) {
  const base = rel.split("/").pop() ?? rel;
  if (/^(README|CHANGELOG|AGENTS|CLAUDE|SETUP)\.md$/iu.test(base)) return true;
  if (/^skills\/[^/]+\/SKILL\.md$/u.test(rel)) return true;
  return false;
}

export function buildDirectoryTree(files: string[]) {
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

export async function readCodePaths(project: string): Promise<string[] | undefined> {
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (!await exists(summaryPath)) return undefined;
  const parsed = safeMatter(`projects/${project}/_summary.md`, await readText(summaryPath), { silent: true });
  if (!parsed) return undefined;
  const paths = parsed.data.code_paths;
  return Array.isArray(paths) ? paths.map(String) : undefined;
}
