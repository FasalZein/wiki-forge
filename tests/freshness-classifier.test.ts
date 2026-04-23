import { afterEach, describe, expect, test } from "bun:test";
import { classifyFreshnessChurn } from "../src/maintenance/freshness-classifier";
import { cleanupTempPaths } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("freshness churn classifier", () => {
  test("classifies docs and config churn as semantic-neutral", () => {
    expect(classifyFreshnessChurn(["README.md", "docs/usage.md", "package.json", "tool.config.ts"])).toEqual({
      semanticNeutral: true,
      neutralFiles: ["README.md", "docs/usage.md", "package.json", "tool.config.ts"].sort(),
      semanticFiles: [],
      reason: "semantic-neutral",
    });
  });

  test("classifies code and mixed churn as semantic", () => {
    expect(classifyFreshnessChurn(["src/auth.ts"])).toMatchObject({
      semanticNeutral: false,
      semanticFiles: ["src/auth.ts"],
      reason: "semantic",
    });
    expect(classifyFreshnessChurn(["README.md", "src/auth.ts"])).toMatchObject({
      semanticNeutral: false,
      semanticFiles: ["src/auth.ts"],
      reason: "semantic",
    });
  });
});
