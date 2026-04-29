import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../_helpers/wiki-subprocess";

const SCANNED_ROOTS = ["src", "tests", "README.md", "SETUP.md", "skills", "architecture"];
const VERSION_TOKEN = "v";
const VERSION_NUMBER = "1";
const VERSIONED_FORGE_REFERENCE = new RegExp([
  `\\b${VERSION_TOKEN.toUpperCase()}${VERSION_NUMBER}\\b`,
  `\\b${VERSION_TOKEN}${VERSION_NUMBER}\\b`,
  `${VERSION_TOKEN}${VERSION_NUMBER}-`,
  `src/${VERSION_TOKEN}${VERSION_NUMBER}`,
  `/${VERSION_TOKEN}${VERSION_NUMBER}`,
  `${VERSION_TOKEN.toUpperCase()}${VERSION_NUMBER}-`,
].join("|"), "u");

describe("stable Forge naming", () => {
  test("project-owned source docs and tests do not reference the removed versioned namespace", () => {
    const offenders = scannedFiles().flatMap((file) => {
      const text = readFileSync(join(repoRoot, file), "utf8");
      return VERSIONED_FORGE_REFERENCE.test(text) ? [file] : [];
    });

    expect(offenders).toEqual([]);
  });
});

function scannedFiles(): string[] {
  return SCANNED_ROOTS.flatMap((entry) => walk(join(repoRoot, entry)))
    .map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
    .filter((file) => /\.(ts|md|json)$/u.test(file))
    .sort();
}

function walk(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}
