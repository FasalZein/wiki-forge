import { describe, expect, test } from "bun:test";
import { evaluateForgeNext } from "../../src/forge/lifecycle/next-intent";
import { renderForgeNextJson, renderForgeNextText } from "../../src/forge/workflow/render-next";

const readySlice = {
  project: "wiki-forge",
  taskId: "WIKI-FORGE-219",
  title: "wire forge cli commands",
  status: "ready" as const,
};

describe("forge next projection", () => {
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

    expect(projection).toMatchObject({
      status: "active",
      project: "wiki-forge",
      activeSliceId: "WIKI-FORGE-217",
      nextAction: "continue-active-slice",
      nextCommand: "wiki forge status wiki-forge WIKI-FORGE-217 --json",
      reason: "Active slice exists; inspect slice status and continue its gates.",
      source: "canonical-records",
    });
    expect(renderForgeNextText(projection)).toBe([
      "Next command: wiki forge status wiki-forge WIKI-FORGE-217 --json",
      "wiki-forge: continue WIKI-FORGE-217",
      "",
      "Next command: wiki forge status wiki-forge WIKI-FORGE-217 --json",
    ].join("\n"));
  });

  test("no active slice returns first ready slice or none", () => {
    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        readySlice,
        { ...readySlice, taskId: "WIKI-FORGE-024", status: "draft" },
      ],
    })).toMatchObject({
      status: "ready",
      project: "wiki-forge",
      nextSliceId: "WIKI-FORGE-219",
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start wiki-forge WIKI-FORGE-219",
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    });

    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
      ],
    })).toMatchObject({
      status: "empty",
      project: "wiki-forge",
      nextAction: "plan-next-slice",
      noSafeCommandReason: "No active, ready, or draft Forge slices exist; create or complete a planning session first.",
      reason: "No startable or releasable Forge slice exists.",
      source: "canonical-records",
    });
  });

  test("draft-only project returns release guidance instead of plan-next-slice", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        { ...readySlice, taskId: "WIKI-FORGE-024", title: "remove old helper", status: "draft" },
        { ...readySlice, taskId: "WIKI-FORGE-025", title: "fix help output", status: "draft" },
      ],
    });

    expect(projection).toMatchObject({
      status: "drafts",
      project: "wiki-forge",
      nextCommand: "wiki forge release wiki-forge WIKI-FORGE-024",
      reason: "Draft slices exist but must be released before start.",
      draftSlices: [
        {
          sliceId: "WIKI-FORGE-024",
          title: "remove old helper",
          commands: {
            release: "wiki forge release wiki-forge WIKI-FORGE-024",
            startAfterRelease: "wiki forge start wiki-forge WIKI-FORGE-024",
          },
        },
        {
          sliceId: "WIKI-FORGE-025",
          title: "fix help output",
          commands: {
            release: "wiki forge release wiki-forge WIKI-FORGE-025",
            startAfterRelease: "wiki forge start wiki-forge WIKI-FORGE-025",
          },
        },
      ],
      nextAction: "release-draft-slice",
      candidates: [
        {
          sliceId: "WIKI-FORGE-024",
          title: "remove old helper",
          nextCommand: "wiki forge release wiki-forge WIKI-FORGE-024",
        },
        {
          sliceId: "WIKI-FORGE-025",
          title: "fix help output",
          nextCommand: "wiki forge release wiki-forge WIKI-FORGE-025",
        },
      ],
      source: "canonical-records",
    });
    const text = renderForgeNextText(projection);
    expect(text).toContain("wiki-forge: draft slices need release before start");
    expect(text.split("\n").slice(0, 3).join("\n")).toContain("Next command: wiki forge release wiki-forge WIKI-FORGE-024");
    expect(text).toContain("WIKI-FORGE-024 remove old helper");
    expect(text).toContain("release: wiki forge release wiki-forge WIKI-FORGE-024");
    expect(text).toContain("start after release: wiki forge start wiki-forge WIKI-FORGE-024");
    expect(text.trimEnd().endsWith("Next command: wiki forge release wiki-forge WIKI-FORGE-024")).toBe(true);
    expect(JSON.parse(renderForgeNextJson(projection))).toEqual(projection);
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
    expect(JSON.parse(renderForgeNextJson(projection))).toMatchObject({
      status: "ready",
      project: "wiki-forge",
      nextSliceId: "WIKI-FORGE-219",
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start wiki-forge WIKI-FORGE-219",
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    });
  });
});
