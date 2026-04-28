import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVault() {
  const vault = tempDir("wiki-v1-memory-vault");
  initVault(vault);
  return vault;
}

describe("V1 Wiki memory note/log commands", () => {
  test("top-level note and log route to V1 typed memory", () => {
    expect(resolveWikiCommand(["note", "demo", "remember", "this"]).command).toBe("v1:note");
    expect(resolveWikiCommand(["v1", "note", "demo", "remember", "this"]).command).toBe("v1:note");
    expect(resolveWikiCommand(["log", "append", "demo", "decision", "Keep it simple"]).command).toBe("v1:log");
    expect(resolveWikiCommand(["v1", "log", "append", "demo", "decision", "Keep it simple"]).command).toBe("v1:log");
  });

  test("note writes a typed project memory record without lifecycle fields", () => {
    const vault = createVault();
    const result = runWiki([
      "note",
      "demo",
      "Keep V1 memory separate from Forge lifecycle.",
      "--agent",
      "pi",
      "--slice",
      "DEMO-001",
      "--json",
    ], { vault });

    expect(result.exitCode).toBe(0);
    const body = result.json();
    expect(body).toMatchObject({
      status: "written",
      kind: "wiki-memory-note",
      project: "demo",
      agent: "pi",
      sliceId: "DEMO-001",
    });
    expect(body.path).toStartWith("projects/demo/memory/notes/");

    const notePath = join(vault, body.path);
    expect(existsSync(notePath)).toBe(true);
    const markdown = readFileSync(notePath, "utf8");
    expect(markdown).toContain("type: wiki-memory-note");
    expect(markdown).toContain("lifecycle_mutation: false");
    expect(markdown).toContain("slice_id: DEMO-001");
    expect(markdown).toContain("Keep V1 memory separate from Forge lifecycle.");
  });

  test("log append and tail are project-scoped typed memory", () => {
    const vault = createVault();
    const append = runWiki([
      "log",
      "append",
      "demo",
      "decision",
      "Disable ambiguous top-level status.",
      "--details",
      "Use wiki forge status instead.",
      "--json",
    ], { vault });

    expect(append.exitCode).toBe(0);
    const entry = append.json();
    expect(entry).toMatchObject({
      status: "written",
      kind: "wiki-memory-log-entry",
      project: "demo",
      entryKind: "decision",
      title: "Disable ambiguous top-level status.",
    });
    expect(entry.path).toStartWith("projects/demo/memory/log/");

    const tail = runWiki(["log", "tail", "demo", "1", "--json"], { vault });
    expect(tail.exitCode).toBe(0);
    expect(tail.json()).toMatchObject({
      kind: "wiki-memory-log-tail",
      project: "demo",
      entries: [{ entryKind: "decision", title: "Disable ambiguous top-level status." }],
    });
  });
});
