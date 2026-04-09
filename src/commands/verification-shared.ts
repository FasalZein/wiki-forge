import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { VERIFICATION_LEVELS, VAULT_ROOT, type VerificationLevel } from "../constants";
import { safeMatter, today, writeNormalizedPage } from "../cli-shared";
import { readVerificationLevel } from "../lib/verification";

export function resolveWikiPagePath(projectRootPath: string, pageArg: string): string {
  const directPath = join(projectRootPath, pageArg);
  if (existsSync(directPath)) return directPath;
  if (!pageArg.endsWith(".md")) {
    const withMd = join(projectRootPath, `${pageArg}.md`);
    if (existsSync(withMd)) return withMd;
  }
  return join(projectRootPath, "modules", pageArg, "spec.md");
}

export function isValidVerificationLevel(value: string): value is VerificationLevel {
  return value === "stale" || VERIFICATION_LEVELS.includes(value as (typeof VERIFICATION_LEVELS)[number]);
}

export function applyVerificationLevel(wikiFilePath: string, level: VerificationLevel, dryRun: boolean, label = relative(VAULT_ROOT, wikiFilePath)) {
  const raw = readFileSync(wikiFilePath, "utf8");
  const parsed = safeMatter(relative(VAULT_ROOT, wikiFilePath), raw);
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, wikiFilePath)}`);
  const currentLevel = readVerificationLevel(parsed.data);
  if (currentLevel && currentLevel !== "stale" && levelIndex(level) < levelIndex(currentLevel)) console.warn(`warning: lowering verification level from ${currentLevel} to ${level}`);
  if (dryRun) {
    console.log(`would update ${label} -> verification_level: ${level}`);
    return true;
  }
  const data = { ...parsed.data, verification_level: level, updated: today() } as Record<string, unknown>;
  if (level !== "stale") {
    delete data.previous_level;
    delete data.stale_since;
  }
  writeNormalizedPage(wikiFilePath, parsed.content, data);
  console.log(`updated ${label} -> verification_level: ${level}`);
  return true;
}

export function computeLevelFromBooleans(data: Record<string, unknown>): VerificationLevel {
  if (data.verification_level && isValidVerificationLevel(String(data.verification_level))) return data.verification_level as VerificationLevel;
  if (data.verified_tests === true) return "test-verified";
  if (data.verified_runtime === true) return "runtime-verified";
  if (data.verified_code === true) return "code-verified";
  return "scaffold";
}

function levelIndex(level: VerificationLevel): number {
  if (level === "stale") return -1;
  return VERIFICATION_LEVELS.indexOf(level);
}
