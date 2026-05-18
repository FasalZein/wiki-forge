import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CHECKLIST_PATH = "docs/production-cleanup-readiness.md";

const REQUIRED_SECTIONS = [
  "## When to run this checklist",
  "## Readiness checks",
  "### CLI surface",
  "### Install and sync behavior",
  "### Stale compatibility code",
  "### Compatibility-preserving tests",
  "### Lifecycle terminology",
  "### Handoff and context continuity",
  "## Refactor slice rules",
];

const REQUIRED_COMMANDS = [
  "wiki checkpoint <project> --repo <path> --base HEAD --json",
  "wiki forge next <project> --repo <path> --json",
  "bun test tests/forge-kernel/command-surface.test.ts tests/cli-help.test.ts",
  "bun run check",
];

describe("production cleanup readiness checklist", () => {
  test("documents the risk areas that must be checked before cleanup refactors", () => {
    const checklist = readFileSync(CHECKLIST_PATH, "utf8");

    for (const section of REQUIRED_SECTIONS) expect(checklist).toContain(section);
    for (const command of REQUIRED_COMMANDS) expect(checklist).toContain(command);

    expect(checklist).toContain("removed commands must not be advertised in help, docs, scripts, or benchmark defaults");
    expect(checklist).toContain("sync:local must not relink the global `wiki` CLI by default");
    expect(checklist).toContain("delete tests that preserve removed lifecycle paths instead of updating them");
    expect(checklist).toContain("prefer Forge/status/checkpoint terminology over legacy gate/closeout wording");
    expect(checklist).toContain("Do not reconstruct the prior conversation");
    expect(checklist).toContain("one cleanup concern per Forge slice");
  });
});
