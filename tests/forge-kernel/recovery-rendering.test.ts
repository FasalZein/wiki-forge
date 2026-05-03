import { describe, expect, test } from "bun:test";
import { renderKernelRejectionJson, renderKernelRejectionText } from "../../src/forge/workflow/render-rejection";
import { evaluateForgeNext } from "../../src/forge/lifecycle/next-intent";

describe("forge recovery rendering", () => {
  test("typed rejections render concise actionable recovery without string parsing", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { project: "wiki-forge", taskId: "WIKI-FORGE-216", title: "first", status: "in-progress" },
        { project: "wiki-forge", taskId: "WIKI-FORGE-217", title: "second", status: "in-progress" },
      ],
    });
    if (projection.status !== "conflict") throw new Error("expected conflict");

    expect(renderKernelRejectionText(projection.rejection)).toBe([
      "rejected MultipleActiveSlices: single-active-slice",
      "next: wiki forge release wiki-forge WIKI-FORGE-216, WIKI-FORGE-217 --reason \"release before starting <next-slice>\"",
    ].join("\n"));
    const parsed = JSON.parse(renderKernelRejectionJson(projection.rejection));
    expect(parsed.code).toBe("MultipleActiveSlices");
    expect(parsed.invariant).toBe("single-active-slice");
    expect(parsed.recovery[0].command).toBe("wiki forge release wiki-forge WIKI-FORGE-216, WIKI-FORGE-217 --reason \"release before starting <next-slice>\"");
  });

});
