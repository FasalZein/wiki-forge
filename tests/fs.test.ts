import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exists, readText, writeText, listDirs, ensureDir, appendText, statFingerprint } from "../src/lib/fs";

let tempDir: string;

function makeTempDir() {
  tempDir = join(tmpdir(), `fs-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("exists", () => {
  test("returns true for existing file", async () => {
    const dir = makeTempDir();
    const file = join(dir, "hello.txt");
    writeFileSync(file, "hi", "utf8");
    expect(await exists(file)).toBe(true);
  });

  test("returns true for existing directory", async () => {
    const dir = makeTempDir();
    expect(await exists(dir)).toBe(true);
  });

  test("returns false for missing path", async () => {
    const dir = makeTempDir();
    expect(await exists(join(dir, "nonexistent.txt"))).toBe(false);
  });
});

describe("readText", () => {
  test("reads file contents as string", async () => {
    const dir = makeTempDir();
    const file = join(dir, "content.txt");
    writeFileSync(file, "hello world", "utf8");
    expect(await readText(file)).toBe("hello world");
  });
});

describe("writeText", () => {
  test("writes content to a new file", async () => {
    const dir = makeTempDir();
    const file = join(dir, "output.txt");
    await writeText(file, "written content");
    expect(await readText(file)).toBe("written content");
  });

  test("creates parent directories if missing", async () => {
    const dir = makeTempDir();
    const file = join(dir, "nested", "deep", "file.txt");
    await writeText(file, "nested");
    expect(await readText(file)).toBe("nested");
  });

  test("overwrites existing file", async () => {
    const dir = makeTempDir();
    const file = join(dir, "overwrite.txt");
    await writeText(file, "first");
    await writeText(file, "second");
    expect(await readText(file)).toBe("second");
  });
});

describe("listDirs", () => {
  test("returns directory names within a directory", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "alpha"));
    mkdirSync(join(dir, "beta"));
    writeFileSync(join(dir, "gamma.txt"), "file", "utf8");
    const result = listDirs(dir);
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
    expect(result).not.toContain("gamma.txt");
  });

  test("returns empty array for directory with no subdirectories", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "file.txt"), "content", "utf8");
    expect(listDirs(dir)).toEqual([]);
  });
});

describe("ensureDir", () => {
  test("creates a directory that does not exist", async () => {
    const dir = makeTempDir();
    const newDir = join(dir, "new", "nested");
    ensureDir(newDir);
    expect(await exists(newDir)).toBe(true);
  });

  test("does not throw if directory already exists", () => {
    const dir = makeTempDir();
    expect(() => ensureDir(dir)).not.toThrow();
  });
});

describe("appendText", () => {
  test("appends content to an existing file", () => {
    const dir = makeTempDir();
    const file = join(dir, "append.txt");
    writeFileSync(file, "first\n", "utf8");
    appendText(file, "second\n");
    const result = readFileSync(file, "utf8");
    expect(result).toBe("first\nsecond\n");
  });
});

describe("statFingerprint", () => {
  test("returns size:mtime for existing file", () => {
    const dir = makeTempDir();
    const file = join(dir, "file.txt");
    writeFileSync(file, "data", "utf8");
    const fp = statFingerprint(file);
    expect(fp).toMatch(/^\d+:\d+(\.\d+)?$/);
  });

  test("returns 'missing' for nonexistent file", () => {
    expect(statFingerprint("/nonexistent/path/file.txt")).toBe("missing");
  });
});
