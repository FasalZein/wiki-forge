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

const GOD_FILES_STILL_IN_COMMANDS = [
  "slice-lifecycle.ts",
  "session.ts",
  "research.ts",
  "maintenance.ts",
  "maintenance-commands.ts",
  "snapshot.ts",
  "hierarchy-commands.ts",
] as const;

const MOVED_FILE_TARGETS: ReadonlyArray<readonly [string, string]> = [
  ["acknowledge-impact.ts", "verification"],
  ["answers.ts", "retrieval"],
  ["automation.ts", "maintenance"],
  ["backlog-collect.ts", "hierarchy"],
  ["backlog-commands.ts", "hierarchy"],
  ["backlog-io.ts", "hierarchy"],
  ["backlog.ts", "hierarchy"],
  ["coordination.ts", "slice"],
  ["dependency-graph.ts", "hierarchy"],
  ["diagnostics.ts", "maintenance"],
  ["index-log-markdown.ts", "hierarchy"],
  ["index-log-relationships.ts", "hierarchy"],
  ["index-log.ts", "hierarchy"],
  ["layers.ts", "hierarchy"],
  ["linting.ts", "verification"],
  ["note-export.ts", "session"],
  ["obsidian.ts", "protocol"],
  ["pipeline.ts", "slice"],
  ["planning.ts", "hierarchy"],
  ["project-setup.ts", "protocol"],
  ["protocol.ts", "protocol"],
  ["qmd-commands.ts", "retrieval"],
  ["repo-scan.ts", "protocol"],
  ["setup.ts", "protocol"],
  ["slice-repair.ts", "slice"],
  ["slice-scaffold.ts", "slice"],
  ["summary.ts", "hierarchy"],
  ["test-health.ts", "verification"],
  ["verification-drift.ts", "verification"],
  ["verification-pages.ts", "verification"],
  ["verification-shared.ts", "verification"],
];

const MOVED_FILES_TO_SRC_ROOT = ["git-utils.ts", "system.ts"] as const;

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

  test("architecture/src-layout.md exists and lists every currently-tracked command basename", () => {
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
    const expectedBasenames = [
      ...GOD_FILES_STILL_IN_COMMANDS,
      ...MOVED_FILE_TARGETS.map(([file]) => file),
      ...MOVED_FILES_TO_SRC_ROOT,
    ].map((f) => f.replace(/\.ts$/u, ""));

    for (const basename of expectedBasenames) {
      expect(content).toContain(basename);
    }
  });
});

describe("WIKI-FORGE-108 leaf-file moves into domain folders", () => {
  test("moved files live in their target domain", () => {
    for (const [file, domain] of MOVED_FILE_TARGETS) {
      const targetPath = join(srcRoot, domain, file);
      expect(existsSync(targetPath), `expected ${domain}/${file}`).toBe(true);
      expect(statSync(targetPath).isFile()).toBe(true);
    }
    for (const file of MOVED_FILES_TO_SRC_ROOT) {
      const targetPath = join(srcRoot, file);
      expect(existsSync(targetPath), `expected src/${file}`).toBe(true);
      expect(statSync(targetPath).isFile()).toBe(true);
    }
  });

  test("no ghost files left in src/commands — only the god-file whitelist remains", () => {
    expect(existsSync(commandsRoot)).toBe(true);
    const remaining = readdirSync(commandsRoot)
      .filter((f) => f.endsWith(".ts"))
      .sort();
    expect(remaining).toEqual([...GOD_FILES_STILL_IN_COMMANDS].sort());
  });
});
