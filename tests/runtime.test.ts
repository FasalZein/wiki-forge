import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCommandOnPath } from "../src/lib/runtime";
import { cleanupTempPaths, tempDir } from "./test-helpers";

const ORIGINAL_PATH = process.env.PATH;

function createCommandFile(dir: string, command: string, executable = true) {
  const filename = process.platform === "win32" ? `${command}.cmd` : command;
  const path = join(dir, filename);
  const content = process.platform === "win32"
    ? "@echo off\r\nexit /b 0\r\n"
    : "#!/bin/sh\nexit 0\n";
  writeFileSync(path, content, "utf8");
  if (process.platform !== "win32") {
    chmodSync(path, executable ? 0o755 : 0o644);
  }
  return path;
}

afterEach(() => {
  cleanupTempPaths();
  if (ORIGINAL_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIGINAL_PATH;
});

describe("runtime command resolution", () => {
  test("finds an executable on PATH", async () => {
    const binDir = tempDir("runtime-path");
    const command = `runtime-found-${Date.now()}`;
    const executable = createCommandFile(binDir, command);
    process.env.PATH = binDir;

    expect(await resolveCommandOnPath(command)).toBe(executable);
  });

  test("returns null for a missing command", async () => {
    process.env.PATH = tempDir("runtime-empty");

    expect(await resolveCommandOnPath(`runtime-missing-${Date.now()}`)).toBeNull();
  });

  test("returns null when PATH is missing or empty", async () => {
    const missingPathCommand = `runtime-no-path-${Date.now()}`;
    delete process.env.PATH;
    expect(await resolveCommandOnPath(missingPathCommand)).toBeNull();

    process.env.PATH = "";
    expect(await resolveCommandOnPath(`${missingPathCommand}-empty`)).toBeNull();
  });

  test("ignores non-executable files on unix", async () => {
    if (process.platform === "win32") return;

    const binDir = tempDir("runtime-nonexec");
    const command = `runtime-nonexec-${Date.now()}`;
    createCommandFile(binDir, command, false);
    process.env.PATH = binDir;

    expect(await resolveCommandOnPath(command)).toBeNull();
  });

  test("reuses the cached result without rescanning PATH", async () => {
    const firstDir = tempDir("runtime-cache-a");
    const secondDir = tempDir("runtime-cache-b");
    const command = `runtime-cache-${Date.now()}`;
    const firstMatch = createCommandFile(firstDir, command);
    createCommandFile(secondDir, command);

    process.env.PATH = firstDir;
    expect(await resolveCommandOnPath(command)).toBe(firstMatch);

    process.env.PATH = secondDir;
    expect(await resolveCommandOnPath(command)).toBe(firstMatch);
  });
});
