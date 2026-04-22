import { CODE_FILE_PATTERN } from "../../constants";
import { slugify } from "../../hierarchy";

// Normalize file basenames for matching: strip conventional suffixes
// (both dotted like ".service" and hyphenated like "-service") and
// normalize separators so "bank-statement.service" matches "bank-statement-service"
const STRIP_SUFFIXES = "service|handler|handlers|routes|controller|repository|module|middleware|guard|interceptor|pipe|filter|resolver|factory|provider|util|utils|helpers|constants|config|types|dto|entity|model|schema|validator|validators";
const STRIP_DOTTED = new RegExp(`[.](${STRIP_SUFFIXES})$`, "u");
const STRIP_HYPHEN = new RegExp(`-(${STRIP_SUFFIXES})$`, "u");

function normalizeBasename(name: string) {
  return name
    .replace(STRIP_DOTTED, "")
    .replace(STRIP_HYPHEN, "")
    .replaceAll(".", "-")
    .toLowerCase();
}

export function isTestFile(file: string) {
  return /(^|\/)(tests?|__tests__)\//u.test(file) || /\.(test|spec)\.[^.]+$/u.test(file) || /\/test_[^/]+\.[^.]+$/u.test(file);
}

export function isCodeFile(file: string) {
  return CODE_FILE_PATTERN.test(file);
}

function codeMatchKeys(file: string) {
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts[parts.length - 1]?.replace(/\.[^.]+$/u, "") ?? normalized;
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const norm = normalizeBasename(basename);
  const keys = new Set<string>();
  // Avoid bare "index" key — too ambiguous, matches any index.test file
  if (norm !== "index") keys.add(norm);
  if (basename.toLowerCase() !== norm && basename.toLowerCase() !== "index") keys.add(basename.toLowerCase());
  const firstSegment = norm.split("-")[0];
  if (firstSegment && firstSegment !== norm && firstSegment !== "index") keys.add(firstSegment);
  if (parent) {
    keys.add(`${parent.toLowerCase()}/${norm}`);
    if (basename.toLowerCase() !== norm) keys.add(`${parent.toLowerCase()}/${basename.toLowerCase()}`);
  }
  if (normalized.startsWith("src/")) keys.add("global-cli");
  return [...keys];
}

function testMatchKeys(file: string) {
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const raw = parts[parts.length - 1]?.replace(/\.[^.]+$/u, "") ?? normalized;
  // Strip test/spec suffixes: .test, .spec (JS/TS) and test_ prefix (Python)
  const basename = raw.replace(/([.-](test|spec))$/u, "").replace(/^test_/u, "");
  const parentCandidates = parts.filter((part) => !/^(tests?|__tests__)$/u.test(part));
  const parent = parentCandidates.length > 1 ? parentCandidates[parentCandidates.length - 2] : "";
  const norm = normalizeBasename(basename);
  const keys = new Set<string>();
  if (norm !== "index") keys.add(norm);
  if (basename.toLowerCase() !== norm && basename.toLowerCase() !== "index") keys.add(basename.toLowerCase());
  if (parent) {
    keys.add(`${parent.toLowerCase()}/${norm}`);
    if (basename.toLowerCase() !== norm) keys.add(`${parent.toLowerCase()}/${basename.toLowerCase()}`);
  }
  if (/(^|\/)(cli-)?smoke\.test\.[^.]+$/u.test(normalized) || /(^|\/)[^/]+\.smoke\.test\.[^.]+$/u.test(normalized)) keys.add("global-cli");
  return [...keys];
}

export function guessModuleName(file: string) {
  const parts = file.replaceAll("\\", "/").split("/").filter(Boolean);
  const filtered = parts.filter((part) => !["src", "app", "apps", "packages", "services", "workers"].includes(part));
  const candidate = filtered[0] || parts[parts.length - 1] || "module";
  return slugify(candidate.replace(/\.[^.]+$/u, ""));
}

export function collectChangedTestHealth(changedFiles: string[]) {
  const changedTestFiles = changedFiles.filter(isTestFile);
  const changedCodeFiles = changedFiles.filter((file) => isCodeFile(file) && !isTestFile(file));
  const changedTestKeys = new Set(changedTestFiles.flatMap(testMatchKeys));
  const codeFilesWithoutChangedTests = changedCodeFiles.filter((file) => !codeMatchKeys(file).some((key) => changedTestKeys.has(key)));
  return {
    changedTestFiles,
    changedCodeFiles,
    codeFilesWithoutChangedTests,
  };
}
