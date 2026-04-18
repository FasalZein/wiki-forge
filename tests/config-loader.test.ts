import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadConfigDetailed, WikiConfigError } from "../src/lib/config";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupLayers(opts: { systemJsonc?: string; projectJsonc?: string } = {}) {
  const cwd = tempDir("wiki-config-cwd");
  const home = tempDir("wiki-config-home");
  if (opts.systemJsonc !== undefined) {
    const dir = join(home, ".config", "wiki-forge");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.jsonc"), opts.systemJsonc, "utf8");
  }
  if (opts.projectJsonc !== undefined) {
    writeFileSync(join(cwd, "wiki.config.jsonc"), opts.projectJsonc, "utf8");
  }
  return { cwd, home };
}

describe("loadConfig — zero-config baseline", () => {
  test("no files anywhere: every leaf has source 'default' and repo.ignore is empty", () => {
    const { cwd, home } = setupLayers();
    const config = loadConfig(cwd, home);
    expect(config.repo.ignore.value).toEqual([]);
    expect(config.repo.ignore.source).toBe("default");
  });
});

describe("loadConfig — layer precedence", () => {
  test("system-only: leaf reports source 'system' with system value", () => {
    const { cwd, home } = setupLayers({
      systemJsonc: `{ "repo": { "ignore": ["build-output/**"] } }`,
    });
    const config = loadConfig(cwd, home);
    expect(config.repo.ignore.value).toEqual(["build-output/**"]);
    expect(config.repo.ignore.source).toBe("system");
  });

  test("project overrides system (project replaces, not merges)", () => {
    const { cwd, home } = setupLayers({
      systemJsonc: `{ "repo": { "ignore": ["a/**"] } }`,
      projectJsonc: `{ "repo": { "ignore": ["b/**"] } }`,
    });
    const config = loadConfig(cwd, home);
    expect(config.repo.ignore.value).toEqual(["b/**"]);
    expect(config.repo.ignore.source).toBe("project");
  });
});

describe("loadConfig — parse errors", () => {
  test("malformed jsonc throws WikiConfigError with absolute path and line/col", () => {
    const { cwd, home } = setupLayers({ projectJsonc: `{ "repo": { "ignore": [` });
    let thrown: unknown;
    try {
      loadConfig(cwd, home);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WikiConfigError);
    const message = (thrown as Error).message;
    expect(message).toContain(join(cwd, "wiki.config.jsonc"));
    expect(message).toMatch(/line \d+, column \d+/u);
    expect((thrown as WikiConfigError).exitCode).toBe(1);
  });
});

describe("loadConfig — type validation", () => {
  test("repo.ignore as string instead of string[] throws with key path + expected type + file path", () => {
    const { cwd, home } = setupLayers({ projectJsonc: `{ "repo": { "ignore": "docs/**" } }` });
    let thrown: unknown;
    try {
      loadConfig(cwd, home);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WikiConfigError);
    const message = (thrown as Error).message;
    expect(message).toContain("repo.ignore");
    expect(message).toContain("string[]");
    expect(message).toContain(join(cwd, "wiki.config.jsonc"));
  });

  test("repo.ignore with non-string element also rejected", () => {
    const { cwd, home } = setupLayers({ projectJsonc: `{ "repo": { "ignore": ["ok/**", 3] } }` });
    expect(() => loadConfig(cwd, home)).toThrow(WikiConfigError);
  });
});

describe("loadConfig — unknown keys", () => {
  test("unknown key warns once and returns valid config", () => {
    const { cwd, home } = setupLayers({ projectJsonc: `{ "repo": { "foo": 1 } }` });
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const config = loadConfig(cwd, home);
      expect(config.repo.ignore.source).toBe("default");
      const calls = spy.mock.calls;
      expect(calls.length).toBe(1);
      expect(String(calls[0][0])).toMatch(/warn: .*unknown key 'repo\.foo'/u);
    } finally {
      spy.mockRestore();
    }
  });

  test("unknown nested key reported with full dotted path", () => {
    const { cwd, home } = setupLayers({
      projectJsonc: `{ "project": { "nested": { "bar": 3 } } }`,
    });
    const { warnings } = loadConfigDetailed(cwd, home);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/unknown key 'project\.nested\.bar'/u);
  });
});

describe("loadConfig — jsonc features", () => {
  test("comments and trailing commas parse successfully", () => {
    const { cwd, home } = setupLayers({
      projectJsonc: `{
        // leading comment
        "repo": {
          "ignore": [
            "docs/**",
            /* trailing comma next */
            "archive/**",
          ],
        },
      }`,
    });
    const config = loadConfig(cwd, home);
    expect(config.repo.ignore.value).toEqual(["docs/**", "archive/**"]);
    expect(config.repo.ignore.source).toBe("project");
  });
});
