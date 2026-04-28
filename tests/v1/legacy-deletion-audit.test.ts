import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const NORMAL_RUNTIME_DIRS = ["src/wiki", "src/forge", "src/v1/cli", "src/v1/forge", "src/v1/handover", "src/v1/memory", "src/v1/prompt", "src/v1/projections", "src/v1/vault"];
const MIGRATION_ONLY_DIRS = ["src/v1/migration"];

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
  "../hierarchy",
  "../../hierarchy",
  "../maintenance",
  "../../maintenance",
  "../verification",
  "../../verification",
];

const LEGACY_WORKFLOW_TEXT = [
  "src/slice/forge",
  "repairHistoricalDoneSlices",
];

describe("V1 legacy deletion audit", () => {
  test("normal runtime surfaces avoid legacy workflow barrels and slice routers", () => {
    const offenders = runtimeFiles().flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      return [...forbiddenImports(source), ...forbiddenText(source)].map((match) => `${file}: ${match}`);
    });

    expect(offenders).toEqual([]);
  });

  test("migration-only V1 code is the only V1 area allowed to mention migration", () => {
    const migrationFiles = tsFilesInDirs(MIGRATION_ONLY_DIRS);
    expect(migrationFiles.length).toBeGreaterThan(0);
    for (const file of migrationFiles) expect(file).toStartWith("src/v1/migration/");
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
