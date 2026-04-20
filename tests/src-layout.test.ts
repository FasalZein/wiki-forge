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

const GOD_FILES_STILL_IN_COMMANDS = [] as const;

const MOVED_FILE_TARGETS: ReadonlyArray<readonly [string, string]> = [
  ["acknowledge-impact.ts", "verification"],
  ["answers.ts", "retrieval"],
  ["backlog-collect.ts", "hierarchy"],
  ["backlog-commands.ts", "hierarchy"],
  ["backlog-io.ts", "hierarchy"],
  ["backlog.ts", "hierarchy"],
  ["coordination.ts", "slice"],
  ["dependency-graph.ts", "hierarchy"],
  ["index-log-markdown.ts", "hierarchy"],
  ["index-log-relationships.ts", "hierarchy"],
  ["index-log.ts", "hierarchy"],
  ["layers.ts", "hierarchy"],
  ["linting.ts", "verification"],
  ["note.ts", "session"],
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
    if (!existsSync(commandsRoot)) {
      // slice 113 removes the final god file; src/commands is fully gone after that slice lands
      expect(GOD_FILES_STILL_IN_COMMANDS).toEqual([]);
      return;
    }
    const remaining = readdirSync(commandsRoot)
      .filter((f) => f.endsWith(".ts"))
      .sort();
    expect(remaining).toEqual([...GOD_FILES_STILL_IN_COMMANDS].sort());
  });
});

describe("WIKI-FORGE-109 slice-lifecycle split into verb files", () => {
  const sliceRoot = join(srcRoot, "slice");
  const verbFiles = ["start.ts", "verify.ts", "close.ts", "claim.ts"] as const;

  test("src/slice/ has start, verify, close, claim files", () => {
    for (const file of verbFiles) {
      const path = join(sliceRoot, file);
      expect(existsSync(path), `expected src/slice/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("no slice verb file exceeds 300 LOC", () => {
    for (const file of verbFiles) {
      const path = join(sliceRoot, file);
      const lines = readFileSync(path, "utf8").split("\n").length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });

  test("src/slice/index.ts has no export *", () => {
    const indexPath = join(sliceRoot, "index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).not.toMatch(/export\s+\*/u);
  });
});

describe("WIKI-FORGE-110 research split by subcommand", () => {
  const researchRoot = join(srcRoot, "research");
  const verbFiles = [
    "scaffold.ts",
    "status.ts",
    "ingest.ts",
    "audit.ts",
    "file.ts",
    "distill.ts",
    "lint.ts",
    "source-ingest.ts",
  ] as const;

  test("src/research/ has one file per subcommand", () => {
    for (const file of verbFiles) {
      const path = join(researchRoot, file);
      expect(existsSync(path), `expected src/research/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("no research file exceeds 250 LOC", () => {
    for (const file of verbFiles) {
      const path = join(researchRoot, file);
      const lines = readFileSync(path, "utf8").split("\n").length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(250);
    }
  });

  test("src/research/index.ts has no export *", () => {
    const indexPath = join(researchRoot, "index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).not.toMatch(/export\s+\*/u);
  });

  test("src/commands/research.ts is gone", () => {
    expect(existsSync(join(commandsRoot, "research.ts"))).toBe(false);
  });
});

describe("WIKI-FORGE-111 session split by concern", () => {
  const sessionRoot = join(srcRoot, "session");
  const verbFiles = ["resume.ts", "handover.ts", "note.ts", "log.ts"] as const;

  test("src/session/ has resume, handover, note, log files", () => {
    for (const file of verbFiles) {
      const path = join(sessionRoot, file);
      expect(existsSync(path), `expected src/session/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("no session file exceeds 250 LOC", () => {
    for (const file of verbFiles) {
      const path = join(sessionRoot, file);
      const lines = readFileSync(path, "utf8").split("\n").length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(250);
    }
  });

  test("src/session/index.ts has no export *", () => {
    const indexPath = join(sessionRoot, "index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).not.toMatch(/export\s+\*/u);
  });

  test("src/commands/session.ts is gone", () => {
    expect(existsSync(join(commandsRoot, "session.ts"))).toBe(false);
  });
});

describe("WIKI-FORGE-112 maintenance + snapshot + drift + test-health split", () => {
  const maintenanceRoot = join(srcRoot, "maintenance");
  const verbFiles = [
    "refresh.ts",
    "closeout.ts",
    "gate.ts",
    "maintain.ts",
    "checkpoint.ts",
    "drift.ts",
    "doctor.ts",
    "commit-check.ts",
  ] as const;

  test("src/maintenance/ has verb-per-file layout", () => {
    for (const file of verbFiles) {
      const path = join(maintenanceRoot, file);
      expect(existsSync(path), `expected src/maintenance/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("no maintenance file exceeds 300 LOC", () => {
    const allFiles = readdirSync(maintenanceRoot).filter((f) => f.endsWith(".ts"));
    for (const file of allFiles) {
      const path = join(maintenanceRoot, file);
      const lines = readFileSync(path, "utf8").split("\n").length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });

  test("src/maintenance/index.ts has no export *", () => {
    const indexPath = join(maintenanceRoot, "index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).not.toMatch(/export\s+\*/u);
  });

  test("old god files are gone", () => {
    expect(existsSync(join(commandsRoot, "maintenance.ts"))).toBe(false);
    expect(existsSync(join(commandsRoot, "maintenance-commands.ts"))).toBe(false);
    expect(existsSync(join(commandsRoot, "snapshot.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "verification", "verification-drift.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "verification", "test-health.ts"))).toBe(false);
  });
});

describe("WIKI-FORGE-113 hierarchy-commands split + curated domain barrels", () => {
  const hierarchyRoot = join(srcRoot, "hierarchy");
  const hierarchyVerbFiles = [
    "feature-status.ts",
    "start-feature.ts",
    "close-feature.ts",
    "start-prd.ts",
    "close-prd.ts",
    "lifecycle.ts",
  ] as const;

  test("src/hierarchy/ has verb files for the lifecycle split", () => {
    for (const file of hierarchyVerbFiles) {
      const path = join(hierarchyRoot, file);
      expect(existsSync(path), `expected src/hierarchy/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("new hierarchy lifecycle files stay under 250 LOC", () => {
    for (const file of hierarchyVerbFiles) {
      const path = join(hierarchyRoot, file);
      const lines = readFileSync(path, "utf8").split("\n").length;
      expect(lines, `${file} has ${lines} lines`).toBeLessThanOrEqual(250);
    }
  });

  test("src/commands/hierarchy-commands.ts is gone", () => {
    expect(existsSync(join(commandsRoot, "hierarchy-commands.ts"))).toBe(false);
  });

  test("src/commands/ is empty after slice 113", () => {
    if (!existsSync(commandsRoot)) return;
    const remaining = readdirSync(commandsRoot).filter((f) => f.endsWith(".ts"));
    expect(remaining).toEqual([]);
  });

  const curatedBarrelDomains = ["hierarchy", "verification", "retrieval", "protocol"] as const;
  test("each target domain has an index.ts without export *", () => {
    for (const domain of curatedBarrelDomains) {
      const indexPath = join(srcRoot, domain, "index.ts");
      expect(existsSync(indexPath), `expected src/${domain}/index.ts`).toBe(true);
      const content = readFileSync(indexPath, "utf8");
      expect(content, `src/${domain}/index.ts must not use export *`).not.toMatch(/export\s+\*/u);
    }
  });
});
