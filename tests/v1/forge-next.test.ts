import { describe, expect, test } from "bun:test";
import { evaluateForgeNext } from "../../src/v1/forge/next-intent";
import { renderForgeNextJson, renderForgeNextText } from "../../src/v1/cli/render-forge-next";

const readySlice = {
  project: "wiki-forge",
  taskId: "WIKI-FORGE-219",
  title: "wire v1 cli commands",
  status: "ready" as const,
};

describe("v1 forge next projection", () => {
  test("one active slice returns next action for that slice", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        { ...readySlice, taskId: "WIKI-FORGE-217", status: "in-progress" },
        readySlice,
      ],
      generatedProjectionActiveSliceId: "WIKI-FORGE-999",
    });

    expect(projection).toEqual({
      status: "active",
      project: "wiki-forge",
      activeSliceId: "WIKI-FORGE-217",
      nextAction: "continue-active-slice",
      source: "canonical-records",
    });
    expect(renderForgeNextText(projection)).toBe("wiki-forge: continue WIKI-FORGE-217");
  });

  test("no active slice returns first ready slice or none", () => {
    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        readySlice,
      ],
    })).toEqual({
      status: "ready",
      project: "wiki-forge",
      nextSliceId: "WIKI-FORGE-219",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });

    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [{ ...readySlice, taskId: "WIKI-FORGE-218", status: "done" }],
    })).toEqual({
      status: "empty",
      project: "wiki-forge",
      nextAction: "plan-next-slice",
      source: "canonical-records",
    });
  });

  test("multiple active slices return typed conflict and recovery", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-216", status: "in-progress" },
        { ...readySlice, taskId: "WIKI-FORGE-217", status: "in-progress" },
      ],
    });

    expect(projection.status).toBe("conflict");
    if (projection.status !== "conflict") throw new Error("expected conflict");
    expect(projection.rejection.code).toBe("MultipleActiveSlices");
    expect(projection.rejection.recovery[0]?.command).toContain("wiki forge release wiki-forge WIKI-FORGE-216, WIKI-FORGE-217");
  });

  test("JSON output is parseable", () => {
    const projection = evaluateForgeNext({ project: "wiki-forge", slices: [readySlice] });
    expect(JSON.parse(renderForgeNextJson(projection))).toEqual({
      status: "ready",
      project: "wiki-forge",
      nextSliceId: "WIKI-FORGE-219",
      nextAction: "start-ready-slice",
      source: "canonical-records",
    });
  });
});
