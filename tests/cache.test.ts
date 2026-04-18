import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileFingerprint, filesFingerprint, readCache, writeCache } from "../src/lib/cache";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("cache", () => {
  test("fileFingerprint returns a size:mtime string for existing files", () => {
    const dir = tempDir("cache-test");
    const filePath = join(dir, "sample.txt");
    writeFileSync(filePath, "hello", "utf8");
    const fp = fileFingerprint(filePath);
    expect(fp).toMatch(/^\d+:\d+(\.\d+)?$/);
  });

  test("fileFingerprint returns a fallback for missing files", () => {
    const fp = fileFingerprint("/nonexistent/path/abc.txt");
    expect(fp).toBe("missing");
  });

  test("filesFingerprint produces a stable hash for the same set of files", () => {
    const dir = tempDir("cache-test");
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "aaa", "utf8");
    writeFileSync(b, "bbb", "utf8");
    const fp1 = filesFingerprint([a, b]);
    const fp2 = filesFingerprint([a, b]);
    expect(fp1).toBe(fp2);
  });

  test("filesFingerprint order-independent for same files (sorted internally)", () => {
    const dir = tempDir("cache-test");
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "aaa", "utf8");
    writeFileSync(b, "bbb", "utf8");
    const fpAB = filesFingerprint([a, b]);
    const fpBA = filesFingerprint([b, a]);
    expect(fpAB).toBe(fpBA);
  });

  test("readCache returns null for missing cache entry", async () => {
    const result = await readCache("test-ns-nonexistent", "nonexistent-key", "v1", "fp1");
    expect(result).toBeNull();
  });

  test("writeCache then readCache round-trips a value", async () => {
    const ns = `_test_roundtrip_${Date.now()}`;
    const key = "test-key";
    const version = "v1";
    const fp = "fp-test";
    const value = { data: [1, 2, 3] };

    await writeCache(ns, key, version, fp, value);
    const result = await readCache<typeof value>(ns, key, version, fp);
    expect(result).toEqual(value);
  });

  test("readCache returns null when version mismatches", async () => {
    const ns = `_test_version_${Date.now()}`;
    const key = "test-key";
    await writeCache(ns, key, "v1", "fp1", { x: 1 });
    const result = await readCache(ns, key, "v2", "fp1");
    expect(result).toBeNull();
  });

  test("readCache returns null when fingerprint mismatches", async () => {
    const ns = `_test_fp_${Date.now()}`;
    const key = "test-key";
    await writeCache(ns, key, "v1", "fp1", { x: 1 });
    const result = await readCache(ns, key, "v1", "fp2");
    expect(result).toBeNull();
  });
});
