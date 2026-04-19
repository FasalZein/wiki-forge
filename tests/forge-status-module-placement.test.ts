import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectForgeStatus, isSliceDocsReady } from "../src/protocol";
import { repoRoot } from "./_helpers/wiki-subprocess";

describe("forge status module placement", () => {
  test("resume uses the shared protocol surface instead of slice internals", () => {
    const source = readFileSync(join(repoRoot, "src", "session", "resume.ts"), "utf8");

    expect(source).toContain('from "../protocol"');
    expect(source).not.toContain("../slice/");
  });

  test("protocol exposes the shared forge status helpers", () => {
    expect(typeof collectForgeStatus).toBe("function");
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "ready" })).toBe(true);
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "incomplete" })).toBe(false);
  });
});
