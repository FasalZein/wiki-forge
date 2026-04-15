import { relative } from "node:path";
import { VAULT_ROOT, type VerificationLevel } from "../constants";
import { assertExists, nowIso, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { readVerificationLevel } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { applyVerificationLevel, computeLevelFromBooleans, isValidVerificationLevel, resolveWikiPagePath } from "./verification-shared";

export async function bindSourcePaths(args: string[]) {
  const { project, pageArg, sourcePaths, mode, dryRun } = parseBindArgs(args);
  const root = projectRoot(project);
  const wikiFilePath = resolveWikiPagePath(root, pageArg);
  assertExists(wikiFilePath, `wiki page not found: ${relative(VAULT_ROOT, wikiFilePath)}`);
  const parsed = safeMatter(relative(VAULT_ROOT, wikiFilePath), await readText(wikiFilePath));
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, wikiFilePath)}`);
  const incomingSourcePaths = normalizeSourcePaths(sourcePaths);
  const currentSourcePaths = normalizeSourcePaths(Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value) => String(value)) : []);
  const nextSourcePaths = mode === "merge" ? normalizeSourcePaths([...currentSourcePaths, ...incomingSourcePaths]) : incomingSourcePaths;
  const unchanged = currentSourcePaths.length === nextSourcePaths.length && currentSourcePaths.every((value, index) => value === nextSourcePaths[index]);
  if (unchanged) return console.log(`source_paths already current for ${relative(VAULT_ROOT, wikiFilePath)}`);
  if (dryRun) {
    console.log(`would update ${relative(VAULT_ROOT, wikiFilePath)}`);
    return console.log(`source_paths: ${nextSourcePaths.join(", ")}`);
  }
  writeNormalizedPage(wikiFilePath, parsed.content, { ...parsed.data, source_paths: nextSourcePaths, updated: nowIso() });
  console.log(`updated ${relative(VAULT_ROOT, wikiFilePath)}`);
}

function parseBindArgs(args: string[]) {
  let dryRun = false;
  let mode: "replace" | "merge" = "replace";
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--mode") {
      const value = args[index + 1];
      requireValue(value, "mode");
      if (value !== "replace" && value !== "merge") throw new Error(`invalid mode: ${value}`);
      mode = value;
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  const project = positional[0];
  const pageArg = positional[1];
  const sourcePaths = positional.slice(2);
  requireValue(project, "project");
  requireValue(pageArg, "module-or-page");
  if (!sourcePaths.length) throw new Error("missing source-paths");
  return { project, pageArg, sourcePaths, mode, dryRun };
}

function normalizeSourcePaths(sourcePaths: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const sourcePath of sourcePaths) {
    const value = sourcePath.trim().replaceAll("\\", "/");
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export async function verifyPage(args: string[]) {
  const dryRun = args.includes("--dry-run");
  const filteredArgs = args.filter((arg) => arg !== "--dry-run");
  const project = filteredArgs[0];
  requireValue(project, "project");
  if (filteredArgs[1] === "--all") {
    const levelArg = filteredArgs[2];
    requireValue(levelArg, "level");
    if (!isValidVerificationLevel(levelArg)) throw new Error(`invalid level: ${levelArg}`);
    const pages = walkMarkdown(projectRoot(project));
    let updatedCount = 0;
    for (const page of pages) {
      if (await applyVerificationLevel(page, levelArg, dryRun, relative(VAULT_ROOT, page), false, { preserveStrongerLevels: true })) updatedCount += 1;
    }
    return console.log(`${dryRun ? "would update" : "updated"} ${updatedCount} page(s) for ${project}`);
  }
  const level = filteredArgs[filteredArgs.length - 1];
  const pageArgs = filteredArgs.slice(1, -1);
  requireValue(level, "level");
  if (!pageArgs.length) throw new Error("missing module-or-page");
  if (!isValidVerificationLevel(level)) throw new Error(`invalid level: ${level}`);
  let updatedCount = 0;
  for (const pageArg of pageArgs) {
    const wikiFilePath = resolveWikiPagePath(projectRoot(project), pageArg);
    assertExists(wikiFilePath, `wiki page not found: ${relative(VAULT_ROOT, wikiFilePath)}`);
    if (await applyVerificationLevel(wikiFilePath, level, dryRun, relative(VAULT_ROOT, wikiFilePath))) updatedCount += 1;
  }
  if (pageArgs.length > 1) console.log(`${dryRun ? "would update" : "updated"} ${updatedCount} page(s) for ${project}`);
}

export async function migrateVerification(project: string | undefined) {
  requireValue(project, "project");
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  let updatedCount = 0;
  for (const file of walkMarkdown(root)) {
    const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
    if (!parsed) continue;
    const hasOldFields = "verified_code" in parsed.data || "verified_runtime" in parsed.data || "verified_tests" in parsed.data;
    if (!hasOldFields && parsed.data.verification_level) continue;
    const nextLevel = computeLevelFromBooleans(parsed.data) as VerificationLevel;
    const data = { ...parsed.data, verification_level: nextLevel } as Record<string, unknown>;
    delete data.verified_code;
    delete data.verified_runtime;
    delete data.verified_tests;
    writeNormalizedPage(file, parsed.content, data);
    updatedCount += 1;
    console.log(`migrated ${relative(VAULT_ROOT, file)} -> ${nextLevel}`);
  }
  console.log(`migrated ${updatedCount} file(s) for ${project}`);
}
