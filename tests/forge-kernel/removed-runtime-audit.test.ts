import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const NORMAL_RUNTIME_DIRS = ["src/wiki", "src/forge"];
const LEGACY_WORKFLOW_IMPORTS = [
  "../slice",
  "../../slice",
  "../slice/forge",
  "../../slice/forge",
  "../slice/pipeline",
  "../../slice/pipeline",
  "../slice/repair",
  "../../slice/repair",
  "../session",
  "../../session",
  "../maintenance",
  "../../maintenance",
];

const LEGACY_WORKFLOW_TEXT = [
  "src/slice/forge",
  "repairHistoricalDoneSlices",
];

describe("Forge legacy deletion audit", () => {
  test("normal runtime surfaces avoid legacy workflow barrels and slice routers", () => {
    const offenders = runtimeFiles().flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      return [...forbiddenImports(source), ...forbiddenText(source)].map((match) => `${file}: ${match}`);
    });

    expect(offenders).toEqual([]);
  });

  test("migration-only Forge code has been removed", () => {
    expect(runtimeFiles().filter((file) => file.startsWith("src/forge/migration/"))).toEqual([]);
  });
});

function runtimeFiles(): string[] {
  return tsFilesInDirs(NORMAL_RUNTIME_DIRS).filter((file) => !file.endsWith(".test.ts"));
}

function tsFilesInDirs(dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) => walk(join(repoRoot, dir))).map((file) => relative(repoRoot, file).replaceAll("\\", "/")).sort();
}

function walk(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(".ts") ? [path] : [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function forbiddenImports(source: string): string[] {
  const imports = source.matchAll(/from\s+["']([^"']+)["']/gu);
  return Array.from(imports)
    .map((match) => match[1])
    .filter((specifier): specifier is string => Boolean(specifier))
    .filter((specifier) => LEGACY_WORKFLOW_IMPORTS.includes(specifier));
}

function forbiddenText(source: string): string[] {
  return LEGACY_WORKFLOW_TEXT.filter((text) => source.includes(text));
}
