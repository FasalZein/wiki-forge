import { describe, expect, test } from "bun:test";
import { renderHealthRecoveryBlock } from "../../src/health/shared/recovery-block";

describe("health recovery block renderer", () => {
  test("renders a copy/paste Recovery fenced bash block", () => {
    const block = renderHealthRecoveryBlock([
      "wiki checkpoint demo --repo . --base HEAD --json",
      "wiki maintain demo --repo . --base HEAD",
    ]);

    expect(block).toEqual([
      "Recovery:",
      "```bash",
      "wiki checkpoint demo --repo . --base HEAD --json",
      "wiki maintain demo --repo . --base HEAD",
      "```",
    ]);
  });

  test("rejects empty recovery command lists", () => {
    expect(() => renderHealthRecoveryBlock([])).toThrow(/at least one command/);
  });
});
