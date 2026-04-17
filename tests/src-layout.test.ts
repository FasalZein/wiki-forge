import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, "src");
const commandsRoot = join(srcRoot, "commands");

const DOMAIN_FOLDERS = [
  "slice",
  "maintenance",
  "research",
  "session",
  "hierarchy",
  "verification",
  "retrieval",
  "protocol",
] as const;

function resolveVaultRoot(): string | null {
  const envRoot = process.env.KNOWLEDGE_VAULT_ROOT?.trim();
  if (envRoot) {
    const resolved = resolve(envRoot);
    return existsSync(resolved) ? resolved : null;
  }
  const home = process.env.HOME;
  if (!home) return null;
  const conventional = join(home, "Knowledge");
  const marker = join(conventional, "AGENTS.md");
  return existsSync(marker) ? conventional : null;
}

describe("WIKI-FORGE-107 src-layout foundation", () => {
  test("src/ has the eight target domain folders", () => {
    for (const domain of DOMAIN_FOLDERS) {
      const path = join(srcRoot, domain);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  test("src/commands/ still contains every existing command file (no moves in this slice)", () => {
    expect(existsSync(commandsRoot)).toBe(true);
    const commandFiles = readdirSync(commandsRoot).filter((f) => f.endsWith(".ts"));
    expect(commandFiles.length).toBeGreaterThan(30);
  });

  test("architecture/src-layout.md exists and lists every current command basename", () => {
    const vault = resolveVaultRoot();
    if (!vault) {
      // CI or machines without a vault: skip silently; the wiki-page assertion
      // is validated by `wiki verify-slice` from the machine that authored the
      // architecture page.
      return;
    }

    const page = join(vault, "projects", "wiki-forge", "architecture", "src-layout.md");
    expect(existsSync(page)).toBe(true);

    const content = readFileSync(page, "utf8");
    const commandFiles = readdirSync(commandsRoot)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/u, ""));

    for (const basename of commandFiles) {
      expect(content).toContain(basename);
    }
  });
});
