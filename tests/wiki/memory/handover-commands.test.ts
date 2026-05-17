import { afterEach, describe, expect, test } from "bun:test";
import { cleanupTempPaths, runWiki, tempDir } from "../../test-helpers";
import { initVault } from "../../test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("memory command CLI output", () => {
  test("note refuses to create a project folder for an unknown project", () => {
    const vault = tempDir("wiki-memory-note-cli");
    initVault(vault);

    const result = runWiki(["note", "note", "this should not create projects/note"], { KNOWLEDGE_VAULT_ROOT: vault });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("project not found: note");
  });

  test("log append refuses to create a project folder for an unknown project", () => {
    const vault = tempDir("wiki-memory-log-cli");
    initVault(vault);

    const result = runWiki(["log", "append", "status", "verification", "this should not create projects/status"], { KNOWLEDGE_VAULT_ROOT: vault });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("project not found: status");
  });

  test("non-JSON handover prints path, summary preview, and user-facing next-session prompt", () => {
    const vault = tempDir("wiki-handover-cli");
    initVault(vault);

    const result = runWiki(
      [
        "handover",
        "demo-project",
        "--summary", "Refactored the entire QMD answer pipeline into five focused modules.",
        "--next-action", "Start the next DDD refactor on slice-store.",
        "--prompt", "Continue from HEAD abc1234. First run checkpoint then forge next.",
      ],
      { vault },
    );

    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();

    // User-facing prompt is primary and points at durable handover/Forge truth.
    expect(stdout.startsWith("ACTION REQUIRED: give the user this copy/paste prompt for the next agent session.")).toBe(true);
    expect(stdout).toContain("Copy/paste prompt for the next agent session:");
    expect(stdout).toContain("```text");
    expect(stdout).toContain("Do not reconstruct the prior conversation");
    expect(stdout).toContain("Minimal refresh:");
    expect(stdout).toContain("wiki checkpoint demo-project");
    expect(stdout).toContain("wiki forge next demo-project");
    expect(stdout).not.toContain("wiki query --bm25");
    expect(stdout).not.toContain("Session summary:");
    expect(stdout).toContain("Next action:");
    expect(stdout).toContain("Operator intent:");
    expect(stdout).toContain("Continue from HEAD abc1234");
    expect(stdout).toContain("```");
    expect(stdout).toMatch(/wrote\s+/);
    expect(stdout).toContain("Refactored");
    expect(stdout).toContain("Do not stop at 'handover written'; paste the prompt above back to the user.");
  });

  test("JSON mode still prints full structured result", () => {
    const vault = tempDir("wiki-handover-json");
    initVault(vault);

    const result = runWiki(
      [
        "handover",
        "demo-project",
        "--json",
        "--summary", "Summary text.",
        "--next-action", "Next.",
        "--prompt", "Continue.",
      ],
      { vault },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.status).toBe("written");
    expect(parsed.handover.summary).toBe("Summary text.");
    expect(parsed.handover.copyPastePrompt).toBe("Continue.");
    expect(parsed.nextSessionPrompt).toContain("Do not reconstruct the prior conversation");
    expect(parsed.handoff).toMatchObject({
      requiresUserCopyPaste: true,
      label: "Copy/paste prompt for the next agent session",
      prompt: parsed.nextSessionPrompt,
      instruction: "Return this prompt to the user verbatim in a fenced text block; do not only summarize the handover path.",
    });
    expect(parsed.nextSessionPrompt).toContain("Minimal refresh:");
    expect(parsed.nextSessionPrompt).toContain("projects/demo-project/forge/handovers/");
    expect(parsed.nextSessionPrompt).not.toContain("wiki query --bm25");
    expect(parsed.nextSessionPrompt).not.toContain("Session summary:\nSummary text.");
    expect(parsed.nextSessionPrompt).toContain("Next action:\nNext.");
    expect(parsed.nextSessionPrompt).toContain("Operator intent:\nContinue.");
    expect(parsed.handover.nextAction).toBe("Next.");
  });

  test("handover without --summary exits with error", () => {
    const vault = tempDir("wiki-handover-no-summary");
    initVault(vault);

    const result = runWiki(
      ["handover", "demo-project", "--next-action", "Next.", "--prompt", "Continue."],
      { vault },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("error");
    expect(result.stderr.toString()).toContain("--summary");
  });
});
