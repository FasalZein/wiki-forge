import { afterEach, describe, expect, test } from "bun:test";
import { cleanupTempPaths, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki help production command surface", () => {
  test("default help does not advertise removed status command", () => {
    const home = tempDir("wiki-help-home");
    const result = runWiki(["help"], { HOME: home, KNOWLEDGE_VAULT_ROOT: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toContain("wiki status [project]");
  });

  test("full help does not advertise removed status command", () => {
    const home = tempDir("wiki-help-all-home");
    const result = runWiki(["help", "--all"], { HOME: home, KNOWLEDGE_VAULT_ROOT: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toContain("wiki status [project]");
  });

  test("default help includes valid research and source subcommands needed for production use", () => {
    const home = tempDir("wiki-help-research-home");
    const result = runWiki(["help"], { HOME: home, KNOWLEDGE_VAULT_ROOT: "" });
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toContain("wiki research scaffold <topic>");
    expect(output).toContain("wiki research lint [topic] [--json]");
    expect(output).toContain("wiki research audit [topic] [--json]");
    expect(output).toContain("wiki research handoff <research-page>");
    expect(output).toContain("wiki research bridge <research-page> --project <project> --slice <slice-id> [--json]");
    expect(output).toContain("wiki source ingest <path-or-url...>");
  });
});
