import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const VAULT_ROOT_ENV = "KNOWLEDGE_VAULT_ROOT";
export const VAULT_ROOT = resolveVaultRoot();
export const QMD_NODE_CLI = process.env.QMD_NODE_CLI ?? "/opt/homebrew/lib/node_modules/@tobilu/qmd/dist/cli/qmd.js";
export const QMD_INDEX_NAME = normalizeQmdIndexName(process.env.QMD_INDEX_NAME);
export const QMD_INDEX_PATH = resolveQmdIndexPath(QMD_INDEX_NAME);

export const PROJECT_DIRS = [
  "modules",
  "architecture",
  "code-map",
  "contracts",
  "data",
  "changes",
  "runbooks",
  "verification",
  "legacy",
  "specs",
] as const;

export const PROJECT_FILES = ["_summary.md", "backlog.md", "decisions.md", "learnings.md"] as const;

export const MODULE_REQUIRED_HEADINGS = [
  "## Highlights",
  "## Ownership",
  "## Key Files",
  "## Interfaces",
  "## Data Model",
  "## Dependencies",
  "## Verification",
  "## Cross Links",
];

export const VERIFICATION_LEVELS = ["scaffold", "inferred", "code-verified", "runtime-verified", "test-verified"] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number] | "stale";

export const STALE_UNVERIFIED_DAYS = 30;
export const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift|vue|svelte|sql|proto|graphql|gql|css|scss|sass|less)$/u;

export const QUERY_STOP_WORDS = new Set([
  "about", "after", "before", "does", "from", "have", "into",
  "that", "them", "this", "what", "when", "where", "which",
  "with", "would", "could", "should", "project",
]);

export function normalizeQmdIndexName(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || "index";
}

export function resolveQmdIndexPath(indexName: string) {
  return join(homedir(), ".cache", "qmd", indexName === "index" ? "index.sqlite" : `${indexName}.sqlite`);
}

function resolveVaultRoot() {
  const envRoot = process.env[VAULT_ROOT_ENV]?.trim();
  if (envRoot) {
    const resolved = resolve(envRoot);
    if (!existsSync(resolved)) {
      throw new Error(`${VAULT_ROOT_ENV} points to non-existent path: ${resolved}`);
    }
    return resolved;
  }

  const detected = findVaultRoot(process.cwd()) ?? findVaultRoot(resolve(import.meta.dir, "..", "..", ".."));
  if (detected) {
    return detected;
  }

  // Fallback: ~/Knowledge is the conventional vault location
  const homeVault = join(homedir(), "Knowledge");
  if (looksLikeVaultRoot(homeVault)) {
    return homeVault;
  }

  return resolve(import.meta.dir, "..", "..", "..");
}

function findVaultRoot(start: string) {
  let current = resolve(start);
  while (true) {
    if (looksLikeVaultRoot(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function looksLikeVaultRoot(path: string) {
  return existsSync(join(path, "AGENTS.md"))
    && existsSync(join(path, "index.md"))
    && existsSync(join(path, "projects"));
}
