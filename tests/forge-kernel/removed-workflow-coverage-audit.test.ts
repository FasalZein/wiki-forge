import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REPLACED_LEGACY_COMMANDS = new Map([
  ["backlog", "wiki forge status"],
  ["add-task", "wiki forge plan"],
  ["move-task", "wiki forge status"],
  ["complete-task", "wiki forge close"],
  ["claim", "wiki forge start"],
  ["start-slice", "wiki forge start"],
  ["verify-slice", "wiki forge evidence"],
  ["close-slice", "wiki forge close"],
  ["pipeline", "wiki forge run"],
  ["pipeline-reset", "wiki forge run"],
  ["create-feature", "wiki forge plan"],
  ["create-prd", "wiki forge plan"],
  ["create-plan", "wiki forge plan"],
  ["create-test-plan", "wiki forge plan"],
  ["create-issue-slice", "wiki forge plan"],
  ["start-feature", "wiki forge plan"],
  ["close-feature", "wiki forge plan"],
  ["start-prd", "wiki forge plan"],
  ["close-prd", "wiki forge plan"],
]);

describe("removed workflow coverage audit", () => {
  test("documents the legacy workflow surfaces covered by Forge", () => {
    const audit = readFileSync(join(repoRoot, "architecture", "legacy-workflow-reachability-audit.md"), "utf8");

    for (const [legacyCommand, replacement] of REPLACED_LEGACY_COMMANDS) {
      expect(audit).toContain(legacyCommand);
      expect(audit).toContain(replacement);
    }
  });

  test("keeps the next focus on deletion reachability rather than one-to-one legacy parity", () => {
    const audit = readFileSync(join(repoRoot, "architecture", "legacy-workflow-reachability-audit.md"), "utf8");

    expect(audit).toContain("Do **not** port legacy one-to-one");
    expect(audit).toContain("Recommended deletion order");
    expect(audit).toContain("The missing old pieces are mostly projections and helper views");
  });
});
