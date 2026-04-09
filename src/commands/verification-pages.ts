import { relative } from "node:path";
import { VAULT_ROOT, type VerificationLevel } from "../constants";
import { assertExists, nowIso, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { readVerificationLevel } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { applyVerificationLevel, computeLevelFromBooleans, isValidVerificationLevel, resolveWikiPagePath } from "./verification-shared";

export async function bindSourcePaths(args: string[]) {
  const dryRun = args.includes("--dry-run");
  const filteredArgs = args.filter((arg) => arg !== "--dry-run");
  const project = filteredArgs[0];
  const pageArg = filteredArgs[1];
  const sourcePaths = filteredArgs.slice(2);
  requireValue(project, "project");
  requireValue(pageArg, "module-or-page");
  if (!sourcePaths.length) throw new Error("missing source-paths");
  const root = projectRoot(project);
  const wikiFilePath = resolveWikiPagePath(root, pageArg);
  assertExists(wikiFilePath, `wiki page not found: ${relative(VAULT_ROOT, wikiFilePath)}`);
  const parsed = safeMatter(relative(VAULT_ROOT, wikiFilePath), await readText(wikiFilePath));
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, wikiFilePath)}`);
  const normalizedSourcePaths = sourcePaths.map((value) => value.replaceAll("\\", "/"));
  const currentSourcePaths = Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value) => String(value)) : [];
  const unchanged = currentSourcePaths.length === normalizedSourcePaths.length && currentSourcePaths.every((value, index) => value === normalizedSourcePaths[index]);
  if (unchanged) return console.log(`source_paths already current for ${relative(VAULT_ROOT, wikiFilePath)}`);
  if (dryRun) {
    console.log(`would update ${relative(VAULT_ROOT, wikiFilePath)}`);
    return console.log(`source_paths: ${normalizedSourcePaths.join(", ")}`);
  }
  writeNormalizedPage(wikiFilePath, parsed.content, { ...parsed.data, source_paths: normalizedSourcePaths, updated: nowIso() });
  console.log(`updated ${relative(VAULT_ROOT, wikiFilePath)}`);
}

export async function verifyPage(args: string[]) {
  const dryRun = args.includes("--dry-run");
  const filteredArgs = args.filter((arg) => arg !== "--dry-run");
  const project = filteredArgs[0];
  const levelArg = filteredArgs[2];
  requireValue(project, "project");
  if (filteredArgs[1] === "--all") {
    requireValue(levelArg, "level");
    if (!isValidVerificationLevel(levelArg)) throw new Error(`invalid level: ${levelArg}`);
    const pages = walkMarkdown(projectRoot(project));
    let updatedCount = 0;
    for (const page of pages) if (await applyVerificationLevel(page, levelArg, dryRun)) updatedCount += 1;
    return console.log(`${dryRun ? "would update" : "updated"} ${updatedCount} page(s) for ${project}`);
  }
  const pageArg = filteredArgs[1];
  const level = filteredArgs[2];
  requireValue(pageArg, "module-or-page");
  requireValue(level, "level");
  if (!isValidVerificationLevel(level)) throw new Error(`invalid level: ${level}`);
  const wikiFilePath = resolveWikiPagePath(projectRoot(project), pageArg);
  assertExists(wikiFilePath, `wiki page not found: ${relative(VAULT_ROOT, wikiFilePath)}`);
  await applyVerificationLevel(wikiFilePath, level, dryRun, relative(VAULT_ROOT, wikiFilePath));
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
