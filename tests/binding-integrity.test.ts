import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";

function resolveVaultRoot(): string | null {
  const envRoot = process.env.KNOWLEDGE_VAULT_ROOT?.trim();
  if (envRoot) {
    const absolute = resolve(envRoot);
    return existsSync(absolute) ? absolute : null;
  }
  const home = process.env.HOME;
  if (!home) return null;
  const fallback = join(home, "Knowledge");
  return existsSync(fallback) ? fallback : null;
}

const VAULT_ROOT = resolveVaultRoot();
const PROJECT_ROOT = VAULT_ROOT ? join(VAULT_ROOT, "projects", "wiki-forge") : null;
const VAULT_READY = Boolean(PROJECT_ROOT && existsSync(PROJECT_ROOT));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

function collectBindings() {
  const projectRoot = PROJECT_ROOT as string;
  const vaultRoot = VAULT_ROOT as string;
  const repoRoot = resolve(import.meta.dir, "..");
  const rows: Array<{ page: string; path: string }> = [];
  for (const page of walk(projectRoot)) {
    const parsed = matter(readFileSync(page, "utf8"));
    const sp = parsed.data.source_paths;
    if (!Array.isArray(sp)) continue;
    for (const entry of sp) {
      if (typeof entry !== "string" || !entry.trim()) continue;
      rows.push({ page: page.slice(vaultRoot.length + 1), path: entry.trim() });
    }
  }
  return { rows, repoRoot };
}

describe.skipIf(!VAULT_READY)("WIKI-FORGE-115 wiki source_paths binding integrity", () => {
  test("vault fixture yields at least one bound page", () => {
    const data = collectBindings();
    expect(data.rows.length).toBeGreaterThan(0);
  });

  test("every bound path resolves to an existing file or directory on disk", () => {
    const data = collectBindings();
    const missing = data.rows.filter((row) => !existsSync(join(data.repoRoot, row.path)));
    expect(missing).toEqual([]);
  });

  test("no wiki page still references the removed src/commands/ layout", () => {
    const data = collectBindings();
    const stragglers = data.rows.filter((row) => row.path === "src/commands" || row.path.startsWith("src/commands/"));
    expect(stragglers).toEqual([]);
  });
});
