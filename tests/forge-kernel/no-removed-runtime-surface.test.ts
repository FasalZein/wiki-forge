import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";
import { WIKI_COMMANDS } from "../../src/wiki";
import { getCommandSurfaceEntry } from "../../src/wiki/runtime/command-surface";

const REMOVED_PATHS = [
  "src/session",
  "src/slice/forge",
  "src/slice/lifecycle",
  "src/slice/repair",
  "src/slice/verification",
  "src/slice/forge.ts",
  "src/slice/forge-output.ts",
  "src/slice/forge-planning.ts",
  "src/slice/start.ts",
];

const REMOVED_COMMANDS = [
  "backlog", "add-task", "move-task", "complete-task", "claim", "forge-start", "forge-verify", "forge-close",
  "pipeline", "pipeline-reset", "create-feature", "create-prd", "create-plan", "create-test-plan", "create-issue-slice",
  "start-feature", "close-feature", "start-prd", "close-prd", "status", "gate", "closeout",
];

describe("no removed runtime surface", () => {
  test("removed runtime paths are deleted from main", () => {
    for (const path of REMOVED_PATHS) expect(existsSync(join(repoRoot, path))).toBe(false);
  });

  test("removed commands are absent from runtime registry", () => {
    for (const command of REMOVED_COMMANDS) {
      expect(WIKI_COMMANDS[command]).toBeUndefined();
      expect(getCommandSurfaceEntry(command)).toBeUndefined();
    }
  });

  test("stable runtime does not import deleted runtime modules", () => {
    const offenders = sourceFiles(["src/wiki", "src/forge", "src/health", "src/index.ts"]).flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      const forbidden = ["../slice/forge", "../../slice/forge", "../slice/lifecycle", "../../slice/lifecycle", "../session", "../../session"];
      return forbidden.filter((specifier) => source.includes(specifier)).map((specifier) => `${file}: ${specifier}`);
    });

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(paths: readonly string[]): string[] {
  return paths.flatMap((path) => walk(join(repoRoot, path)))
    .map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".ts"))
    .sort();
}

function walk(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}
