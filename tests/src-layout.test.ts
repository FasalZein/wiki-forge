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

  test("src/ exposes top-level wiki and forge seams", () => {
    for (const seam of ["wiki", "forge"] as const) {
      const path = join(srcRoot, seam);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
      expect(existsSync(join(path, "index.ts"))).toBe(true);
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

describe("WIKI-FORGE-180 lib drainage and first-wave contract", () => {
  test("architecture/src-layout.md records the first-wave pack-out rules", () => {
    const vault = resolveVaultRoot();
    if (!vault) {
      return;
    }

    const page = join(vault, "projects", "wiki-forge", "architecture", "src-layout.md");
    expect(existsSync(page)).toBe(true);

    const content = readFileSync(page, "utf8");
    expect(content).toContain("`src/lib/` is infrastructure-only");
    expect(content).toContain("The first migration wave targets only the overloaded domains");
    expect(content).toContain("Subdomain maps are capability / lifecycle first");
    expect(content).toContain("The campaign starts with `lib` drainage");
    expect(content).toContain("1. `lib` drainage");
    expect(content).toContain("maintenance/checkpoint");
    expect(content).toContain("slice/verification");
  });

  test("slice-specific lib helpers are namespaced under src/lib/slices", () => {
    const helpers = ["plan-summary.ts", "placeholders.ts"] as const;
    for (const file of helpers) {
      const path = join(srcRoot, "lib", "slices", file);
      expect(existsSync(path), `expected src/lib/slices/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("domain registries are namespaced under explicit lib folders", () => {
    const expectedFiles = [
      ["project-paths", "index.ts"],
      ["workflow-config", "index.ts"],
      ["wiki-contracts", "state-contract.ts"],
    ] as const;
    for (const [dir, file] of expectedFiles) {
      const path = join(srcRoot, "lib", dir, file);
      expect(existsSync(path), `expected src/lib/${dir}/${file}`).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
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

describe("PRD-079 session subdomain pack-out", () => {
  const sessionRoot = join(srcRoot, "session");
  const sessionSubdomains = ["resume", "handover", "note", "continuation", "shared"] as const;
  const sessionEntryShims = [
    ["resume.ts", './resume/index'],
    ["handover.ts", './handover/index'],
    ["note.ts", './note/index'],
    ["next.ts", './continuation/next'],
    ["resume-triage.ts", './continuation/resume-triage'],
    ["handover-narrative.ts", './continuation/handover-narrative'],
    ["_shared.ts", './shared'],
  ] as const;

  test("src/session/ exposes the accepted subdomain folders", () => {
    for (const subdomain of sessionSubdomains) {
      const path = join(sessionRoot, subdomain);
      expect(existsSync(path), `expected src/session/${subdomain}`).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  test("session root files are thin shims into the new subdomain surfaces", () => {
    for (const [file, target] of sessionEntryShims) {
      const path = join(sessionRoot, file);
      const content = readFileSync(path, "utf8");
      expect(content).toContain(target);
      expect(content.split("\n").length, `${file} should stay thin`).toBeLessThanOrEqual(12);
    }
  });
});

describe("PRD-079 hierarchy subdomain pack-out", () => {
  const hierarchyRoot = join(srcRoot, "hierarchy");
  const hierarchySubdomains = ["backlog", "lifecycle", "planning", "graph", "status", "projection"] as const;
  const hierarchyEntryShims = [
    ["backlog.ts", "./backlog/index"],
    ["lifecycle.ts", "./lifecycle/index"],
    ["planning.ts", "./planning/index"],
    ["dependency-graph.ts", "./graph"],
    ["feature-status.ts", "./status"],
    ["index-log.ts", "./projection/index-log"],
    ["summary.ts", "./projection/summary"],
    ["layers.ts", "./projection/layers"],
  ] as const;

  test("src/hierarchy/ exposes the accepted subdomain folders", () => {
    for (const subdomain of hierarchySubdomains) {
      const path = join(hierarchyRoot, subdomain);
      expect(existsSync(path), `expected src/hierarchy/${subdomain}`).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  test("hierarchy root files are thin shims into the new subdomain surfaces", () => {
    for (const [file, target] of hierarchyEntryShims) {
      const path = join(hierarchyRoot, file);
      const content = readFileSync(path, "utf8");
      expect(content).toContain(target);
      expect(content.split("\n").length, `${file} should stay thin`).toBeLessThanOrEqual(20);
    }
  });
});

describe("PRD-079 maintenance subdomain pack-out", () => {
  const maintenanceRoot = join(srcRoot, "maintenance");
  const maintenanceSubdomains = ["checkpoint", "lint", "drift", "sync", "closeout", "doctor", "health", "shared"] as const;
  const maintenanceEntryShims = [
    ["checkpoint.ts", "./checkpoint/index"],
    ["lint-repo.ts", "./lint/index"],
    ["drift.ts", "./drift/index"],
    ["sync.ts", "./sync/index"],
    ["refresh.ts", "./sync/refresh"],
    ["commit-check.ts", "./sync/commit-check"],
    ["closeout.ts", "./closeout/index"],
    ["gate.ts", "./closeout/gate"],
    ["maintain.ts", "./closeout/maintain"],
    ["doctor.ts", "./doctor/index"],
    ["dashboard.ts", "./doctor/dashboard"],
    ["discover.ts", "./doctor/discover"],
    ["test-health.ts", "./health/index"],
    ["_shared.ts", "./shared/index"],
  ] as const;

  test("src/maintenance/ exposes the accepted subdomain folders", () => {
    for (const subdomain of maintenanceSubdomains) {
      const path = join(maintenanceRoot, subdomain);
      expect(existsSync(path), `expected src/maintenance/${subdomain}`).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  test("maintenance root files are thin shims into the new subdomain surfaces", () => {
    for (const [file, target] of maintenanceEntryShims) {
      const path = join(maintenanceRoot, file);
      const content = readFileSync(path, "utf8");
      expect(content).toContain(target);
      expect(content.split("\n").length, `${file} should stay thin`).toBeLessThanOrEqual(20);
    }
  });

  test("maintenance-owned helper seams no longer live under src/lib", () => {
    expect(existsSync(join(srcRoot, "lib", "diagnostics.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "dirty-repo.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "drift-query.ts"))).toBe(false);
  });
});

describe("PRD-079 slice subdomain pack-out", () => {
  const sliceRoot = join(srcRoot, "slice");
  const sliceSubdomains = ["verification", "lifecycle", "coordination", "forge", "repair", "docs", "pipeline", "shared"] as const;
  const sliceEntryShims = [
    ["_shared.ts", "./shared/index"],
    ["claim.ts", "./coordination/claim"],
    ["coordination.ts", "./coordination/index"],
    ["start.ts", "./lifecycle/start"],
    ["close.ts", "./lifecycle/close"],
    ["verify.ts", "./verification/index"],
    ["slice-repair.ts", "./repair/index"],
    ["slice-scaffold.ts", "./docs/scaffold"],
    ["forge.ts", "./forge/index"],
    ["forge-run.ts", "./forge/run"],
    ["forge-args.ts", "./forge/args"],
    ["forge-docs.ts", "./forge/docs"],
    ["forge-evidence-readers.ts", "./forge/evidence-readers"],
    ["forge-output.ts", "./forge/output"],
    ["forge-planning.ts", "./forge/planning"],
    ["pipeline.ts", "./pipeline/index"],
    ["pipeline-plan.ts", "./pipeline/plan"],
    ["pipeline-runner.ts", "./pipeline/runner"],
  ] as const;

  test("src/slice/ exposes the accepted subdomain folders", () => {
    for (const subdomain of sliceSubdomains) {
      const path = join(sliceRoot, subdomain);
      expect(existsSync(path), `expected src/slice/${subdomain}`).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  test("slice root files are thin shims into the new subdomain surfaces", () => {
    for (const [file, target] of sliceEntryShims) {
      const path = join(sliceRoot, file);
      const content = readFileSync(path, "utf8");
      expect(content).toContain(target);
      expect(content.split("\n").length, `${file} should stay thin`).toBeLessThanOrEqual(20);
    }
  });

  test("slice-owned helper seams no longer live under src/lib", () => {
    expect(existsSync(join(srcRoot, "lib", "slices.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "slice-progress.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "slice-local.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "slice-query.ts"))).toBe(false);
  });
});

describe("PRD-079 protocol subdomain pack-out", () => {
  const protocolRoot = join(srcRoot, "protocol");
  const protocolSubdomains = ["source", "status", "steering", "setup", "discovery", "integrations"] as const;
  const protocolEntryShims = [
    ["source.ts", "./source/index"],
    ["forge-status.ts", "./status/index"],
    ["forge-status-format.ts", "./status/format"],
    ["forge-status-ledger.ts", "./status/ledger"],
    ["forge-status-triage.ts", "./status/triage"],
    ["forge-ledger-detect.ts", "./status/detect"],
    ["steering.ts", "./steering/index"],
    ["steering-triage.ts", "./steering/triage"],
    ["protocol.ts", "./setup/index"],
    ["project-setup.ts", "./setup/project"],
    ["setup.ts", "./setup/shell"],
    ["repo-scan.ts", "./discovery/index"],
    ["obsidian.ts", "./integrations/obsidian"],
  ] as const;

  test("src/protocol/ exposes the accepted subdomain folders", () => {
    for (const subdomain of protocolSubdomains) {
      const path = join(protocolRoot, subdomain);
      expect(existsSync(path), `expected src/protocol/${subdomain}`).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  test("protocol root files are thin shims into the new subdomain surfaces", () => {
    for (const [file, target] of protocolEntryShims) {
      const path = join(protocolRoot, file);
      const content = readFileSync(path, "utf8");
      expect(content).toContain(target);
      expect(content.split("\n").length, `${file} should stay thin`).toBeLessThanOrEqual(20);
    }
  });

  test("protocol-owned helper seams no longer live under src/lib", () => {
    expect(existsSync(join(srcRoot, "lib", "protocol-source.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "repo-scan.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "obsidian.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "forge-evidence.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "forge-ledger.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "forge-phase-commands.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "forge-steering.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "lib", "forge-triage.ts"))).toBe(false);
  });
});
