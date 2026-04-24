const DOCUMENTATION_EXTENSIONS = new Set([
  ".adoc",
  ".md",
  ".mdx",
  ".rst",
  ".txt",
]);

const CONFIG_FILENAMES = new Set([
  ".editorconfig",
  ".gitignore",
  ".npmrc",
  "bunfig.toml",
  "package.json",
  "tsconfig.json",
]);

const CONFIG_EXTENSIONS = new Set([
  ".config.js",
  ".config.mjs",
  ".config.ts",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
]);

export type FreshnessChurnClassification = {
  semanticNeutral: boolean;
  neutralFiles: string[];
  semanticFiles: string[];
  reason: "no-changes" | "semantic-neutral" | "semantic";
};

export function classifyFreshnessChurn(changedFiles: string[]): FreshnessChurnClassification {
  const normalized = changedFiles.map((file) => file.replaceAll("\\", "/")).filter(Boolean).sort();
  const semanticFiles = normalized.filter((file) => !isSemanticNeutralPath(file));
  let reason: FreshnessChurnClassification["reason"] = "semantic";
  if (normalized.length === 0) reason = "no-changes";
  else if (semanticFiles.length === 0) reason = "semantic-neutral";
  return {
    semanticNeutral: semanticFiles.length === 0,
    neutralFiles: normalized.filter((file) => !semanticFiles.includes(file)),
    semanticFiles,
    reason,
  };
}

export function isSemanticNeutralPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? normalized;
  if (CONFIG_FILENAMES.has(basename)) return true;
  if (normalized.startsWith("docs/") || normalized.startsWith("documentation/")) return true;
  if (basename.toLowerCase().startsWith("readme")) return true;
  return hasKnownSuffix(normalized, DOCUMENTATION_EXTENSIONS) || hasKnownSuffix(normalized, CONFIG_EXTENSIONS);
}

function hasKnownSuffix(file: string, suffixes: Set<string>) {
  const lower = file.toLowerCase();
  return [...suffixes].some((suffix) => lower.endsWith(suffix));
}
