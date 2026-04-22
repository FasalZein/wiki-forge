import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildForgeTriage, collectForgeStatus, compactForgeStatusForJson, isSliceDocsReady } from "../src/protocol";
import { repoRoot } from "./_helpers/wiki-subprocess";

describe("forge status module placement", () => {
  test("resume uses the shared protocol surface instead of slice internals", () => {
    const source = readFileSync(join(repoRoot, "src", "session", "resume", "index.ts"), "utf8");

    expect(source).toContain('from "../../protocol"');
    expect(source).toContain('from "../../slice/pipeline/index"');
    expect(source).not.toContain('from "../../slice/forge');
    expect(source).not.toContain('from "../../slice/lifecycle');
  });

  test("forge-status delegates helper concerns to dedicated protocol modules", () => {
    const source = readFileSync(join(repoRoot, "src", "protocol", "forge-status.ts"), "utf8");

    expect(source).toContain('from "./status/index"');
    expect(readFileSync(join(repoRoot, "src", "protocol", "status", "index.ts"), "utf8")).toContain('from "./ledger"');
    expect(readFileSync(join(repoRoot, "src", "protocol", "status", "index.ts"), "utf8")).toContain('from "./triage"');
    expect(source).not.toContain("function readAuthoredHubLedger");
    expect(source).not.toContain("function mergeAuthoredLedgers");
    expect(source).not.toContain("function normalizeForgeValidationForCloseableSlice");
    expect(source).not.toContain("function compactForgeStatusForJson");
  });

  test("session note uses approved public surfaces instead of slice internals for verification commands", () => {
    const source = readFileSync(join(repoRoot, "src", "session", "note", "index.ts"), "utf8");

    expect(source).toContain('from "../../verification"');
    expect(source).toContain('from "../../slice/docs"');
    expect(source).not.toContain('from "../../slice/forge');
    expect(source).not.toContain('from "../../slice/lifecycle');
  });

  test("protocol exposes the shared forge status helpers", () => {
    expect(typeof collectForgeStatus).toBe("function");
    expect(typeof buildForgeTriage).toBe("function");
    expect(typeof compactForgeStatusForJson).toBe("function");
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "ready" })).toBe(true);
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "incomplete" })).toBe(false);
  });
});
