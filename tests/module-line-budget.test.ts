import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "./_helpers/wiki-subprocess";

const MAX_MODULE_LINES = 400;
const CHECKED_ROOTS = ["src", "tests"] as const;

describe("module line budget", () => {
  test("source and test modules stay below the architecture line ceiling", () => {
    const oversized = CHECKED_ROOTS.flatMap((root) => typeScriptFiles(join(repoRoot, root)))
      .map((file) => ({ file: relative(repoRoot, file).replaceAll("\\", "/"), lines: lineCount(file) }))
      .filter(({ lines }) => lines > MAX_MODULE_LINES)
      .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));

    expect(oversized).toEqual([]);
  });
});

function typeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return typeScriptFiles(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

function lineCount(file: string): number {
  const content = readFileSync(file, "utf8");
  if (!content) return 0;
  return content.split(/\r?\n/u).length;
}
