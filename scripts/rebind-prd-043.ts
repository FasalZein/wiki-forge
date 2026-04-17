#!/usr/bin/env bun
// One-off migration: rebind wiki pages from old src/commands/* paths to
// the new domain layout introduced by PRD-043 (slices 107–113).
// After slice 115 lands and this script has been run, delete this file.

import { readdirSync, statSync } from "node:fs";
import { relative } from "node:path";
import { join } from "node:path";
import { VAULT_ROOT } from "../src/constants";
import { nowIso, projectRoot, safeMatter, writeNormalizedPage } from "../src/cli-shared";
import { readText } from "../src/lib/fs";

const PROJECT = "wiki-forge";

const RENAMES: Record<string, string> = {
  "src/commands": "src",
  "src/commands/acknowledge-impact.ts": "src/verification/acknowledge-impact.ts",
  "src/commands/answers.ts": "src/retrieval/answers.ts",
  "src/commands/automation.ts": "src/maintenance",
  "src/commands/backlog-collect.ts": "src/hierarchy/backlog-collect.ts",
  "src/commands/backlog-commands.ts": "src/hierarchy/backlog-commands.ts",
  "src/commands/backlog-io.ts": "src/hierarchy/backlog-io.ts",
  "src/commands/backlog.ts": "src/hierarchy/backlog.ts",
  "src/commands/coordination.ts": "src/slice/coordination.ts",
  "src/commands/dependency-graph.ts": "src/hierarchy/dependency-graph.ts",
  "src/commands/diagnostics.ts": "src/maintenance",
  "src/commands/git-utils.ts": "src/git-utils.ts",
  "src/commands/hierarchy-commands.ts": "src/hierarchy",
  "src/commands/index-log-markdown.ts": "src/hierarchy/index-log-markdown.ts",
  "src/commands/index-log-relationships.ts": "src/hierarchy/index-log-relationships.ts",
  "src/commands/index-log.ts": "src/hierarchy/index-log.ts",
  "src/commands/layers.ts": "src/hierarchy/layers.ts",
  "src/commands/linting.ts": "src/verification/linting.ts",
  "src/commands/maintenance-commands.ts": "src/maintenance",
  "src/commands/maintenance.ts": "src/maintenance",
  "src/commands/obsidian.ts": "src/protocol/obsidian.ts",
  "src/commands/pipeline.ts": "src/slice/pipeline.ts",
  "src/commands/planning.ts": "src/hierarchy/planning.ts",
  "src/commands/project-setup.ts": "src/protocol/project-setup.ts",
  "src/commands/protocol.ts": "src/protocol/protocol.ts",
  "src/commands/qmd-commands.ts": "src/retrieval/qmd-commands.ts",
  "src/commands/repo-scan.ts": "src/protocol/repo-scan.ts",
  "src/commands/research.ts": "src/research",
  "src/commands/session.ts": "src/session",
  "src/commands/slice-lifecycle.ts": "src/slice",
  "src/commands/slice-repair.ts": "src/slice/slice-repair.ts",
  "src/commands/slice-scaffold.ts": "src/slice/slice-scaffold.ts",
  "src/commands/snapshot.ts": "src/maintenance",
  "src/commands/summary.ts": "src/hierarchy/summary.ts",
  "src/commands/system.ts": "src/system.ts",
  "src/commands/verification-drift.ts": "src/maintenance/drift.ts",
  "src/commands/verification-pages.ts": "src/verification/verification-pages.ts",
  "src/commands/verification-shared.ts": "src/verification/verification-shared.ts",
  "src/commands/verification.ts": "src/verification",
  // Orphaned historical reference: WIKI-FORGE-097 documented managed-block logic
  // as a notional src/managed-block.ts file that never existed; the behavior
  // lives inside src/protocol/protocol.ts.
  "src/managed-block.ts": "src/protocol/protocol.ts",
};

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkMarkdown(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

function normalize(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const value = raw.trim().replaceAll("\\", "/");
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

const dryRun = process.argv.includes("--dry-run");
const root = projectRoot(PROJECT);
const pages = walkMarkdown(root);
let updatedCount = 0;
const updatedPages: string[] = [];

for (const page of pages) {
  const relPath = relative(VAULT_ROOT, page);
  const parsed = safeMatter(relPath, await readText(page), { silent: true });
  if (!parsed) continue;
  const current = parsed.data.source_paths;
  if (!Array.isArray(current)) continue;
  const next: string[] = [];
  let touched = false;
  for (const entry of current) {
    if (typeof entry !== "string") {
      next.push(entry as unknown as string);
      continue;
    }
    if (RENAMES[entry] !== undefined) {
      next.push(RENAMES[entry]);
      touched = true;
    } else {
      next.push(entry);
    }
  }
  if (!touched) continue;
  const deduped = normalize(next);
  const currentNorm = normalize(current.map((v) => String(v)));
  const unchanged = currentNorm.length === deduped.length && currentNorm.every((value, index) => value === deduped[index]);
  if (unchanged) continue;
  updatedPages.push(relPath);
  updatedCount += 1;
  if (dryRun) continue;
  writeNormalizedPage(page, parsed.content, { ...parsed.data, source_paths: deduped, updated: nowIso() });
}

console.log(`${dryRun ? "[dry-run] would update" : "updated"}: ${updatedCount}`);
if (process.argv.includes("--verbose")) {
  for (const page of updatedPages) console.log(`  ${page}`);
}
