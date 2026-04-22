import { describe, expect, test } from "bun:test";

describe("wiki-output-tokens script", () => {
  test("reports structured counts for an arbitrary wiki command", () => {
    const result = Bun.spawnSync([process.execPath, "scripts/wiki-output-tokens.ts", "help"], {
      cwd: process.cwd(),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString()) as {
      command: string[];
      stdout: { tokens: number; chars: number };
      stderr: { tokens: number; chars: number };
    };
    expect(json.command).toEqual(["help"]);
    expect(json.stdout.tokens).toBeGreaterThan(0);
    expect(json.stdout.chars).toBeGreaterThan(0);
    expect(json.stderr.tokens).toBe(0);
    expect(json.stderr.chars).toBe(0);
  });
});
