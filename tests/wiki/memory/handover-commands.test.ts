import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, tempDir } from "../../test-helpers";
import { initVault } from "../../test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("handover command CLI output", () => {
  test("non-JSON handover prints path, summary preview, and copy/paste prompt block", () => {
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

    // Written path is printed
    expect(stdout).toMatch(/wrote\s+/);

    // Summary preview or confirmation of rich summary
    expect(stdout).toContain("Refactored");

    // Copy/paste prompt block
    expect(stdout).toContain("```text");
    expect(stdout).toContain("Continue from HEAD abc1234");
    expect(stdout).toContain("```");
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
