import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseJsonc } from "jsonc-parser";

export const VAULT_ROOT_ENV = "KNOWLEDGE_VAULT_ROOT";
export const VAULT_ROOT = resolveVaultRoot();
export const QMD_NODE_CLI = process.env.QMD_NODE_CLI?.trim() || undefined;
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

export { TEST_VERIFIED_LEVEL, VERIFICATION_LEVELS } from "./shared/verification/levels";
export type { VerificationLevel } from "./shared/verification/levels";

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

  const configRoot = readConfiguredVaultRoot(process.cwd());
  if (configRoot) return configRoot;

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

function readConfiguredVaultRoot(cwd: string): string | null {
  const candidates = [
    join(cwd, "wiki.config.jsonc"),
    join(homedir(), ".config", "wiki-forge", "config.jsonc"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const parsed = parseJsonc(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) continue;
    const vault = parsed.vault;
    if (!isRecord(vault) || typeof vault.root !== "string" || !vault.root.trim()) continue;
    const resolved = resolve(vault.root.replace(/^~/u, homedir()));
    if (!existsSync(resolved)) throw new Error(`vault.root in ${path} points to non-existent path: ${resolved}`);
    return resolved;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
