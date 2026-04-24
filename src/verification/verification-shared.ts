import { join, relative } from "node:path";
import { VERIFICATION_LEVELS, VAULT_ROOT, type VerificationLevel } from "../constants";
import { nowIso, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { readVerificationLevel } from "../lib/verification";
import { printError, printLine } from "../lib/cli-output";

export async function resolveWikiPagePath(projectRootPath: string, pageArg: string): Promise<string> {
  const directPath = join(projectRootPath, pageArg);
  if (await exists(directPath)) return directPath;
  if (!pageArg.endsWith(".md")) {
    const withMd = join(projectRootPath, `${pageArg}.md`);
    if (await exists(withMd)) return withMd;
  }
  return join(projectRootPath, "modules", pageArg, "spec.md");
}

export function isValidVerificationLevel(value: string): value is VerificationLevel {
  return value === "stale" || VERIFICATION_LEVELS.includes(value as (typeof VERIFICATION_LEVELS)[number]);
}

export async function applyVerificationLevel(
  wikiFilePath: string,
  level: VerificationLevel,
  dryRun: boolean,
  label = relative(VAULT_ROOT, wikiFilePath),
  silent = false,
  options?: { preserveStrongerLevels?: boolean; allowDowngrade?: boolean },
) {
  const raw = await readText(wikiFilePath);
  const parsed = safeMatter(relative(VAULT_ROOT, wikiFilePath), raw);
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, wikiFilePath)}`);
  const currentLevel = readVerificationLevel(parsed.data);
  const loweringLevel = currentLevel && currentLevel !== "stale" && level !== "stale" && levelIndex(level) < levelIndex(currentLevel);
  const preserveStrongerLevels = level !== "stale" && !options?.allowDowngrade && (options?.preserveStrongerLevels ?? true);
  if (preserveStrongerLevels && loweringLevel) {
    if (!silent) printLine(`skipped ${label} (kept stronger verification_level: ${currentLevel})`);
    return false;
  }
  if (!silent && loweringLevel) printError(`warning: lowering verification level from ${currentLevel} to ${level}`);
  if (dryRun) {
    if (!silent) printLine(`would update ${label} -> verification_level: ${level}`);
    return true;
  }
  const data = { ...parsed.data, verification_level: level, updated: nowIso() } as Record<string, unknown>;
  if (level !== "stale") {
    delete data.previous_level;
    delete data.stale_since;
  }
  writeNormalizedPage(wikiFilePath, parsed.content, data);
  if (!silent) printLine(`updated ${label} -> verification_level: ${level}`);
  return true;
}

export function computeLevelFromBooleans(data: Record<string, unknown>): VerificationLevel {
  if (data.verification_level && isValidVerificationLevel(String(data.verification_level))) return data.verification_level as VerificationLevel;
  if (data.verified_tests) return "test-verified";
  if (data.verified_runtime) return "runtime-verified";
  if (data.verified_code) return "code-verified";
  return "scaffold";
}

function levelIndex(level: VerificationLevel): number {
  if (level === "stale") return -1;
  return VERIFICATION_LEVELS.indexOf(level);
}
