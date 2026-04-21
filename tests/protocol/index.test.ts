import { describe, expect, test } from "bun:test";
import { buildForgeTriage, collectForgeStatus, compactForgeStatusForJson, isSliceDocsReady } from "../../src/protocol";

describe("protocol index exports", () => {
  test("re-exports forge status helpers", () => {
    expect(typeof collectForgeStatus).toBe("function");
    expect(typeof buildForgeTriage).toBe("function");
    expect(typeof compactForgeStatusForJson).toBe("function");
    expect(isSliceDocsReady({ planStatus: "ready", testPlanStatus: "ready" })).toBe(true);
  });
});
