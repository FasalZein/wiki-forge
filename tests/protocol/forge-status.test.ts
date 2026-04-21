import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectForgeStatus } from "../../src/protocol";
import { repoRoot } from "../_helpers/wiki-subprocess";

describe("forge status facade", () => {
  test("remains importable from the shared protocol surface", () => {
    expect(typeof collectForgeStatus).toBe("function");
  });

  test("keeps orchestration in the facade and delegates helper concerns", () => {
    const source = readFileSync(join(repoRoot, "src", "protocol", "forge-status.ts"), "utf8");

    expect(source).toContain("buildAuthoredForgeStatusLedger");
    expect(source).toContain("resolveForgeStatusLedger");
    expect(source).toContain("buildForgeTriage");
    expect(source).not.toContain("function readAuthoredHubLedger");
    expect(source).not.toContain("function compactForgeStatusForJson");
  });
});
