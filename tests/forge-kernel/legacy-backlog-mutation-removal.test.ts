import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const REMOVED_FILES = [
  "src/hierarchy/backlog/commands.ts",
  "src/hierarchy/backlog-commands.ts",
];

const FORBIDDEN_BACKLOG_MUTATORS = [
  "backlogCommand",
  "addTask",
  "moveTask",
  "completeTask",
];

describe("legacy backlog mutation removal", () => {
  test("deletes legacy backlog command entrypoints", () => {
    for (const file of REMOVED_FILES) expect(existsSync(join(repoRoot, file))).toBe(false);
  });

  test("backlog public facades expose readers, not mutation commands", () => {
    const facadeFiles = [
      readFileSync(join(repoRoot, "src", "hierarchy", "backlog.ts"), "utf8"),
      readFileSync(join(repoRoot, "src", "hierarchy", "backlog", "index.ts"), "utf8"),
    ];

    for (const source of facadeFiles) {
      for (const name of FORBIDDEN_BACKLOG_MUTATORS) expect(source).not.toContain(name);
    }
  });
});
