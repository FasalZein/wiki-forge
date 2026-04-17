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
  const vault = resolveVaultRoot();
  if (!vault) return null;
  const projectRoot = join(vault, "projects", "wiki-forge");
  if (!existsSync(projectRoot)) return null;
  const repoRoot = resolve(import.meta.dir, "..");
  const rows: Array<{ page: string; path: string }> = [];
  for (const page of walk(projectRoot)) {
    const parsed = matter(readFileSync(page, "utf8"));
    const sp = parsed.data.source_paths;
    if (!Array.isArray(sp)) continue;
    for (const entry of sp) {
      if (typeof entry !== "string" || !entry.trim()) continue;
      rows.push({ page: page.slice(vault.length + 1), path: entry.trim() });
    }
  }
  return { rows, repoRoot };
}

describe("WIKI-FORGE-115 wiki source_paths binding integrity", () => {
  test("every bound path resolves to an existing file or directory on disk", () => {
    const data = collectBindings();
    if (!data) return;
    const missing = data.rows.filter((row) => !existsSync(join(data.repoRoot, row.path)));
    expect(missing).toEqual([]);
  });

  test("no wiki page still references the removed src/commands/ layout", () => {
    const data = collectBindings();
    if (!data) return;
    const stragglers = data.rows.filter((row) => row.path === "src/commands" || row.path.startsWith("src/commands/"));
    expect(stragglers).toEqual([]);
  });
});
