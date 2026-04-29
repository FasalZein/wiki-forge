import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { listCommandSurfaceEntries } from "../../src/wiki/runtime/command-surface";

const HIDDEN_LEGACY_HELP = [
  "wiki backlog ",
  "wiki add-task ",
  "wiki move-task ",
  "wiki complete-task",
  "wiki claim ",
  "wiki start-slice ",
  "wiki verify-slice ",
  "wiki close-slice ",
  "wiki create-issue-slice ",
  "wiki pipeline ",
  "wiki pipeline-reset ",
  "wiki gate ",
  "wiki closeout ",
];

const ADMIN_VIEW_COMMANDS = [
  "dashboard",
  "dependency-graph",
  "summary",
  "update-index",
  "feature-status",
  "checkpoint",
  "maintain",
  "refresh",
  "refresh-from-git",
  "sync",
  "discover",
  "ingest-diff",
  "commit-check",
  "install-git-hook",
  "refresh-on-merge",
  "lint-repo",
  "doctor",
  "drift-check",
];

describe("admin/view read-model surface", () => {
  test("admin/view commands are not lifecycle mutation authorities", () => {
    const entries = listCommandSurfaceEntries();
    for (const command of ADMIN_VIEW_COMMANDS) {
      const entry = entries.find((candidate) => candidate.publicCommands.includes(command));
      expect(entry ? { domain: entry.domain, mayMutateLifecycle: entry.mayMutateLifecycle } : null, command).toEqual({
        domain: "admin-view",
        mayMutateLifecycle: false,
      });
    }
  });

  test("full help does not advertise removed lifecycle commands as admin tools", () => {
    const helpSource = readFileSync(join(repoRoot, "src", "cli-shared.ts"), "utf8");
    for (const legacyCommand of HIDDEN_LEGACY_HELP) expect(helpSource).not.toContain(legacyCommand);
    expect(helpSource).toContain("wiki forge status");
    expect(helpSource).toContain("wiki checkpoint");
  });

  test("stable Forge workflow module does not carry removed plan mutators", () => {
    const source = readFileSync(join(repoRoot, "src", "forge", "workflow", "commands.ts"), "utf8");
    expect(source).not.toContain("removedForgePlanSentinel");
    expect(source).not.toContain("createFeatureReturningId");
    expect(source).not.toContain("createPrdReturningId");
    expect(source).not.toContain("createIssueSliceCore");
    expect(source).not.toContain("startSliceCore");
  });
});
